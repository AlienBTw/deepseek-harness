import { describe, expect, it, afterEach } from 'vitest'
import { Context } from '@maple/cordis'
import AgentLoop from '@maple/agent-loop'
import { agentEvents, Inbox, type Agent } from '@maple/agent'
import { createUserMessage } from '@maple/llm'
import SessionStore, { SessionId } from '@maple/session'
import { renderPrompt } from '@maple/system-prompt'
import {
  assertDeriveMessagesReplay,
  mountAgentLoopTestDependencies,
  SessionReplayTracker,
  waitForIdle,
  waitForSessionEvent,
  waitForStatus,
  withDeriveMessagesReplay,
} from '../src/index.ts'

describe('dsh-agent-loop-testkit', () => {
  const contexts: Context[] = []
  afterEach(async () => {
    while (contexts.length > 0) {
      const ctx = contexts.pop()
      if (ctx === undefined) break
      await ctx.fiber.dispose()
    }
  })

  it('mounts a configurable prerequisite spine that can activate AgentLoop', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx, {
      systemPrompt: { persona: 'Test persona.' },
      tools: { mode: 'native' },
    })

    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Test persona.')
    await expect(ctx.plugin(AgentLoop, { agents: [] })).resolves.toBeDefined()
  })

  it('waits for the next matching agent status and session event', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('wait-helpers'))
    const agent: Agent = {
      id: session.id,
      options: {},
      session,
      inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
      status: 'idle',
      ctx,
      send: () => {},
      followup: () => {},
      steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
      inject: () => {},
      cancel() {},
      runMaintenance: task => task(new AbortController().signal),
      whenIdle: () => Promise.resolve(),
    }
    const idle = waitForIdle(ctx, agent)
    const running = waitForStatus(ctx, agent, 'running')
    const userEvents = waitForSessionEvent(ctx, session, 'user/message', 1)
    const dispatch = agentEvents(ctx, agent)

    queueMicrotask(() => {
      dispatch.emit('agent/status', { status: 'running' })
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'go' }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      dispatch.emit('agent/status', { status: 'idle' })
    })

    await running
    expect(await userEvents).toHaveLength(1)
    await idle
  })

  it('asserts deriveMessages replay for a tracked session log', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('replay-helpers'))
    const tracker = new SessionReplayTracker(ctx)
    tracker.track(session)

    await withDeriveMessagesReplay(ctx, session, async () => {
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
    })

    const replayed = assertDeriveMessagesReplay(ctx, session, SessionId('replay-helpers-seed'))
    expect(replayed.events.at(-1)?.type).toBe('session/end-seed')
    tracker.assertAll()
  })
})
