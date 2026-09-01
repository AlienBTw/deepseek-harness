/**
 * Task Surface ApiProxy paths: active reads, submit admission, dismiss, and
 * absent-service refusal when the host composition mounts no Task Surface
 * service.
 */

import { describe, expect, it } from 'vitest'
import { Context, Service } from '@maple/cordis'
import { Inbox } from '@maple/agent'
import AgentRegistry from '@maple/agent'
import type { Agent } from '@maple/agent'
import { CallId, createToolResultMessage, createUserMessage } from '@maple/llm'
import SessionStore, { SessionId } from '@maple/session'
import type { JsonValue, Session, SessionEvent } from '@maple/session'
import UserQuestionService from '@maple/user-questions'
import {
  TaskSurfaceDismissalId,
  TaskSurfaceId,
  TaskSurfaceSubmissionId,
} from '@maple/task-surface/src/brand.ts'
import { formatTaskSurfaceSubmission } from '@maple/task-surface/src/format-submission.ts'
import { foldTaskSurfaceEvent, initialTaskSurfaceProjection } from '@maple/task-surface/src/projection.ts'
import type {
  DismissTaskSurfaceRequest,
  DismissTaskSurfaceResult,
  GetActiveTaskSurfaceResult,
  SubmitTaskSurfaceRequest,
  SubmitTaskSurfaceResult,
  TaskSurfaceModelV1,
  TaskSurfacePendingSubmission,
  TaskSurfacePresentationMeta,
} from '@maple/task-surface/types'
import type { ApiProxy, RpcRequest } from '@maple/host-apiproxy/api'
import { RpcId } from '@maple/host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

const testModel: TaskSurfaceModelV1 = {
  version: 1,
  title: 'Choose Environment',
  sections: [
    {
      id: 'sec-1',
      blocks: [{ kind: 'markdown', text: 'Select target environment' }],
    },
  ],
  fields: [
    {
      kind: 'choice',
      id: 'env',
      label: 'Target Environment',
      options: [
        { id: 'staging', label: 'Staging' },
        { id: 'prod', label: 'Production' },
      ],
    },
  ],
  submit: { label: 'Deploy' },
}

/** Minimal Task Surface service for ApiProxy delegation tests (no projection registry). */
class TestTaskSurfaceService extends Service {
  readonly pendingSubmissions = new Map<string, TaskSurfacePendingSubmission>()

  constructor(ctx: Context) {
    super(ctx, 'taskSurface')
  }

  getActive(input: { session: Session }): GetActiveTaskSurfaceResult {
    const { session } = input
    let state = initialTaskSurfaceProjection
    for (const event of session.events) {
      state = foldTaskSurfaceEvent(state, event)
    }
    if (!state.active) return { active: false, reason: 'not-open' }

    const { callId, surfaceId } = state.active
    const resultEvent = session.events.find((event): event is SessionEvent<'tool/result'> => {
      if (event.type !== 'tool/result') return false
      return event.data.message.source.callId === callId
    })
    if (resultEvent === undefined) return { active: false, reason: 'not-open' }

    const meta = resultEvent.data.meta as TaskSurfacePresentationMeta | undefined
    if (!meta || meta.surfaceId !== surfaceId) return { active: false, reason: 'not-open' }

    return {
      active: true,
      callId,
      surfaceId,
      model: meta.model,
      pending: this.pendingSubmissions.get(surfaceId) ?? null,
    }
  }

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

  dismiss(input: DismissTaskSurfaceRequest & { session: Session }): DismissTaskSurfaceResult {
    const { session, surfaceId, dismissalId } = input
    const activeResult = this.getActive({ session })
    if (!activeResult.active || activeResult.surfaceId !== surfaceId) {
      return { dismissed: false, reason: 'not-open' }
    }
    if (this.pendingSubmissions.has(surfaceId)) {
      return { dismissed: false, reason: 'submission-pending' }
    }
    const event = session.append('task-surface/dismissed', { surfaceId, dismissalId })
    return { dismissed: true, eventSeq: event.seq }
  }
}

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`task-surface-${String(nextRpc++)}`), payload }
}

function agent(ctx: Context, session: Session): Agent {
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  } as Agent
}

function openSurface(session: Session, surfaceId: TaskSurfaceId, callId: CallId): void {
  const meta: TaskSurfacePresentationMeta = {
    kind: 'dsh/task-surface',
    version: 1,
    surfaceId,
    model: testModel,
  }
  session.append('turn/start', { turn: 1 })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: 'Rendered Choice: Choose Environment' }],
      isError: false,
    }),
    meta: meta as unknown as JsonValue,
  }, { surfaceOp: 'append' })
}

async function harness(withTaskSurface = true): Promise<{ ctx: Context; api: ApiProxy; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  if (withTaskSurface) await ctx.plugin(TestTaskSurfaceService)
  const session = ctx.sessions.create(SessionId('ts-session'))
  ctx.agents.register(agent(ctx, session))
  return {
    ctx,
    api: createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }),
    session,
  }
}

describe('taskSurface RPC', () => {
  it('returns not-open when no surface is active', async () => {
    const { api } = await harness()

    const response = await api.taskSurface.getActive(request({ sessionId: SessionId('ts-session') }))

    expect(response.result).toEqual({ ok: true, value: { active: false, reason: 'not-open' } })
  })

  it('reads an active surface and pins surfaceId on getActive', async () => {
    const { api, session } = await harness()
    const surfaceId = TaskSurfaceId('surf-1')
    openSurface(session, surfaceId, CallId('call-1'))

    const active = await api.taskSurface.getActive(request({ sessionId: session.id, surfaceId }))
    expect(active.result).toMatchObject({
      ok: true,
      value: { active: true, surfaceId, model: testModel, pending: null },
    })

    const stale = await api.taskSurface.getActive(request({
      sessionId: session.id,
      surfaceId: TaskSurfaceId('other'),
    }))
    expect(stale.result).toEqual({ ok: true, value: { active: false, reason: 'not-open' } })
  })

  it('submits through the session agent', async () => {
    const { api, session } = await harness()
    const surfaceId = TaskSurfaceId('surf-2')
    openSurface(session, surfaceId, CallId('call-2'))

    const submit = await api.taskSurface.submit(request({
      sessionId: session.id,
      surfaceId,
      submissionId: TaskSurfaceSubmissionId('sub-1'),
      values: { env: 'staging' },
      note: 'go',
    }))
    expect(submit.result).toMatchObject({ ok: true, value: { accepted: true, phase: 'queued' } })
  })

  it('dismisses an active surface without starting a turn', async () => {
    const { api, session } = await harness()
    const surfaceId = TaskSurfaceId('surf-3')
    openSurface(session, surfaceId, CallId('call-3'))

    const dismiss = await api.taskSurface.dismiss(request({
      sessionId: session.id,
      surfaceId,
      dismissalId: TaskSurfaceDismissalId('dsm-1'),
    }))
    expect(dismiss.result.ok).toBe(true)
    if (!dismiss.result.ok) throw new Error('unreachable')
    expect(dismiss.result.value.dismissed).toBe(true)

    const closed = await api.taskSurface.getActive(request({ sessionId: session.id }))
    expect(closed.result).toEqual({ ok: true, value: { active: false, reason: 'not-open' } })
  })

  it('rejects dismiss while a submission is pending', async () => {
    const { api, session } = await harness()
    const surfaceId = TaskSurfaceId('surf-4')
    openSurface(session, surfaceId, CallId('call-4'))

    await api.taskSurface.submit(request({
      sessionId: session.id,
      surfaceId,
      submissionId: TaskSurfaceSubmissionId('sub-2'),
      values: { env: 'staging' },
    }))

    const dismiss = await api.taskSurface.dismiss(request({
      sessionId: session.id,
      surfaceId,
      dismissalId: TaskSurfaceDismissalId('dsm-2'),
    }))
    expect(dismiss.result).toEqual({
      ok: true,
      value: { dismissed: false, reason: 'submission-pending' },
    })
  })

  it('refuses when the host composition mounts no Task Surface service', async () => {
    const { api } = await harness(false)

    const response = await api.taskSurface.getActive(request({ sessionId: SessionId('ts-session') }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.message).toContain('task surface service is absent')
  })
})
