import { describe, expect, it } from 'vitest'
import { Context } from '@maple/cordis'
import { Inbox } from '@maple/agent'
import type { Agent } from '@maple/agent'
import { CallId, createToolResultMessage } from '@maple/llm'
import { Session, SessionId, type JsonValue } from '@maple/session'
import { TaskSurfaceId, TaskSurfaceSubmissionId, TaskSurfaceDismissalId } from '../src/brand.ts'
import { TaskSurfaceService } from '../src/service.ts'
import type { TaskSurfaceModelV1, TaskSurfacePresentationMeta } from '../src/types.ts'

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

function testAgent(session: Session): Agent {
  const followups: unknown[] = []
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: new Context(),
    followup: (message) => { followups.push(message) },
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ;(agent as Agent & { followups: unknown[] }).followups = followups
  return agent
}

describe('TaskSurfaceService', () => {
  it('detects active surface from session tool/result event and queues submit via followup', async () => {
    const ctx = new Context()
    await ctx.plugin(TaskSurfaceService)

    const session = Session.create(SessionId('sess-1'))
    const agent = testAgent(session)
    const surfaceId = TaskSurfaceId('surf-1')
    const callId = CallId('call-1')

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

    const activeBefore = ctx.taskSurface.getActive({ session })
    expect(activeBefore.active).toBe(true)

    const submitResult = await ctx.taskSurface.submit({
      session,
      agent,
      sessionId: session.id,
      surfaceId,
      submissionId: TaskSurfaceSubmissionId('sub-1'),
      values: { env: 'staging' },
      note: 'Deploy immediately',
    })

    expect(submitResult.accepted).toBe(true)
    expect(ctx.taskSurface.pendingSubmissions.has(surfaceId)).toBe(true)
  })

  it('supports dismissing active surface without starting a turn', async () => {
    const ctx = new Context()
    await ctx.plugin(TaskSurfaceService)

    const session = Session.create(SessionId('sess-2'))
    const surfaceId = TaskSurfaceId('surf-2')
    const callId = CallId('call-2')

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

    const dismissResult = ctx.taskSurface.dismiss({
      session,
      sessionId: session.id,
      surfaceId,
      dismissalId: TaskSurfaceDismissalId('dsm-1'),
    })

    expect(dismissResult.dismissed).toBe(true)

    const activeAfter = ctx.taskSurface.getActive({ session })
    expect(activeAfter.active).toBe(false)
  })
})
