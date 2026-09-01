/**
 * Host TaskSurfaceService implementation.
 * @module @maple/task-surface/service
 */

import type { ZodType } from 'zod'
import { z as zod } from 'zod'
import { Context } from '@maple/cordis'
import type { Agent } from '@maple/agent'
import { TypertRemoteService, Remote } from '@maple/typert-protocol'
// Type-only: resolves ctx.sessionProjections for the projection unit child.
import type {} from '@maple/session-projection'
import { createUserMessage } from '@maple/llm'
import type { Session, SessionEvent } from '@maple/session'
import type {
  DismissTaskSurfaceRequest,
  DismissTaskSurfaceRemoteRequest,
  DismissTaskSurfaceResult,
  GetActiveTaskSurfaceRemoteRequest,
  GetActiveTaskSurfaceResult,
  SubmitTaskSurfaceRemoteRequest,
  SubmitTaskSurfaceRequest,
  SubmitTaskSurfaceResult,
  TaskSurfacePendingSubmission,
  TaskSurfacePresentationMeta,
  TaskSurfaceProjection,
} from './types.ts'
import { installTaskSurfaceCoordination } from './coordination.ts'
import { formatTaskSurfaceSubmission } from './format-submission.ts'
import { foldTaskSurfaceEvent, initialTaskSurfaceProjection } from './projection.ts'

declare module '@maple/cordis' {
  interface Context {
    taskSurface: TaskSurfaceService
  }
}

const taskSurfaceProjectionSchema = zod.object({
  active: zod.union([
    zod.object({
      callId: zod.string(),
      surfaceId: zod.string(),
    }),
    zod.null(),
  ]),
}) as ZodType<TaskSurfaceProjection>

/**
 * Service managing active Task Surface state, idempotent submissions, and dismissals.
 */
export class TaskSurfaceService extends TypertRemoteService {
  readonly pendingSubmissions: Map<string, TaskSurfacePendingSubmission> = new Map()

  constructor(ctx: Context) {
    super(ctx, 'taskSurface')
    ctx.effect(() => installTaskSurfaceCoordination(ctx, this.pendingSubmissions))
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'taskSurface', TaskSurfaceProjection>({
        key: 'taskSurface',
        stateSchema: taskSurfaceProjectionSchema,
        init: () => initialTaskSurfaceProjection,
        apply: (state, event) => foldTaskSurfaceEvent(state, event),
        wire: { viewSchema: taskSurfaceProjectionSchema, view: state => state },
        stateVersion: 1,
      })
    })
  }

  /**
   * Retrieve active surface for a session.
   * @param input - query containing target session.
   * @returns active surface information or not-open status.
   */
  getActive(input: { session: Session }): GetActiveTaskSurfaceResult {
    const { session } = input
    let state = initialTaskSurfaceProjection

    for (const event of session.events) {
      state = foldTaskSurfaceEvent(state, event)
    }

    if (!state.active) {
      return { active: false, reason: 'not-open' }
    }

    const { callId, surfaceId } = state.active
    const resultEvent = session.events.find(
      (e): e is SessionEvent & { type: 'tool/result' } => {
        if (e.type !== 'tool/result') return false
        const eventCallId = e.data.message.source.callId
        return eventCallId === callId
      },
    )

    if (!resultEvent) {
      return { active: false, reason: 'not-open' }
    }

    const meta = resultEvent.data.meta as TaskSurfacePresentationMeta | undefined
    if (!meta || meta.surfaceId !== surfaceId) {
      return { active: false, reason: 'not-open' }
    }

    const pending = this.pendingSubmissions.get(surfaceId) ?? null

    return {
      active: true,
      callId,
      surfaceId,
      model: meta.model,
      pending,
    }
  }

  /**
   * Submit values for an active Task Surface.
   * @param input - submission request with field values, target session, and live agent.
   * @returns submission outcome and queued message ID.
   */
  submit(input: SubmitTaskSurfaceRequest & { session: Session; agent: Agent }): Promise<SubmitTaskSurfaceResult> {
    const { session, agent, surfaceId, submissionId, values, note } = input
    const activeResult = this.getActive({ session })

    if (!activeResult.active || activeResult.surfaceId !== surfaceId) {
      return Promise.resolve({ accepted: false, reason: 'not-open' })
    }

    const pending = this.pendingSubmissions.get(surfaceId)
    if (pending) {
      if (pending.submissionId === submissionId) {
        return Promise.resolve({ accepted: true, messageId: pending.messageId, phase: pending.phase })
      }
      return Promise.resolve({ accepted: false, reason: 'submission-pending' })
    }

    if (activeResult.model.fields) {
      for (const field of activeResult.model.fields) {
        if (field.required && values[field.id] === undefined) {
          return Promise.resolve({ accepted: false, reason: 'invalid-submission' })
        }
      }
    }

    const text = formatTaskSurfaceSubmission(activeResult.model, values, note)
    const userMsg = createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        kind: 'user',
        taskSurface: {
          callId: activeResult.callId,
          surfaceId,
          submissionId,
        },
      },
    })

    const newPending: TaskSurfacePendingSubmission = {
      submissionId,
      messageId: userMsg.id,
      phase: 'queued',
    }
    this.pendingSubmissions.set(surfaceId, newPending)
    agent.followup(userMsg)

    return Promise.resolve({ accepted: true, messageId: userMsg.id, phase: 'queued' })
  }

  /**
   * Dismiss an active Task Surface.
   * @param input - dismissal request with target session.
   * @returns dismissal outcome and appended event sequence number.
   */
  dismiss(input: DismissTaskSurfaceRequest & { session: Session }): DismissTaskSurfaceResult {
    const { session, surfaceId, dismissalId } = input
    const activeResult = this.getActive({ session })

    if (!activeResult.active || activeResult.surfaceId !== surfaceId) {
      return { dismissed: false, reason: 'not-open' }
    }

    if (this.pendingSubmissions.has(surfaceId)) {
      return { dismissed: false, reason: 'submission-pending' }
    }

    const event = session.append('task-surface/dismissed', {
      surfaceId,
      dismissalId,
    })

    return { dismissed: true, eventSeq: event.seq }
  }

  /**
   * Retrieve the active Task Surface for one session through the remote boundary.
   * @param request - session to inspect.
   * @returns active surface information or not-open status.
   */
  @Remote('getActive')
  remoteGetActive(request: GetActiveTaskSurfaceRemoteRequest): GetActiveTaskSurfaceResult {
    const session = this.ctx.sessions.get(request.sessionId)
    if (session === undefined) return { active: false, reason: 'not-open' }
    return this.getActive({ session })
  }

  /**
   * Submit values for the active Task Surface through the remote boundary.
   * @param agent - live agent resolved from the wire session identity.
   * @param request - submission payload without the resolved session id.
   * @returns submission outcome and queued message id when accepted.
   */
  @Remote('submit')
  remoteSubmit(agent: Agent, request: SubmitTaskSurfaceRemoteRequest): Promise<SubmitTaskSurfaceResult> {
    return this.submit({
      ...request,
      sessionId: agent.session.id,
      session: agent.session,
      agent,
    })
  }

  /**
   * Dismiss the active Task Surface through the remote boundary.
   * @param agent - live agent resolved from the wire session identity.
   * @param request - dismissal payload without the resolved session id.
   * @returns dismissal outcome and appended event sequence when dismissed.
   */
  @Remote('dismiss')
  remoteDismiss(agent: Agent, request: DismissTaskSurfaceRemoteRequest): DismissTaskSurfaceResult {
    return this.dismiss({
      ...request,
      sessionId: agent.session.id,
      session: agent.session,
    })
  }
}
