import { describe, expect, it } from 'vitest'
import { Context } from '@maple/cordis'
import { createUserMessage } from '@maple/llm'
import { SessionId, type TurnEndReason } from '@maple/session'
import type { Agent } from '@maple/agent'
import AgentLoop from '@maple/agent-loop'
import { mountAgentLoopTestDependencies } from '@maple/agent-loop-testkit'
import * as RunBudget from '@maple/run-budget'
import type { Config } from '@maple/run-budget'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { defineContentToolFixture } from '@maple/tools'

/** Boot the core spine plus the spend-cap guard. */
async function harness(config: Config): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(RunBudget, config)
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

describe('run-budget config', () => {
  it('rejects a non-positive maxTurnsPerRun at load', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(RunBudget, { maxTurnsPerRun: 0 })).rejects.toThrow(/maxTurnsPerRun|min/)
  }, 30_000)

  it('rejects a non-positive maxOutputTokensPerTurn at load', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(RunBudget, { maxOutputTokensPerTurn: -1 })).rejects.toThrow(/maxOutputTokensPerTurn|min/)
  }, 30_000)
})

describe('maxTurnsPerRun', () => {
  it('ends the second turn of one wake with quota MAX_TURNS', async () => {
    const ctx = await harness({ maxTurnsPerRun: 1 })
    const adapter = new MockAdapter([textResponse('first'), textResponse('second')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('cap-turns'), { provider: 'mock', model: 'mock' })
    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'turn/end') reasons.push(event.data.reason)
    })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'one' }],
      source: { kind: 'user' },
    }))
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'two' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(ctx, agent)

    expect(reasons).toEqual([
      { kind: 'completed' },
      { kind: 'quota', code: 'MAX_TURNS' },
    ])
    expect(adapter.requests).toHaveLength(1)
  }, 60_000)
})

describe('maxOutputTokensPerTurn', () => {
  it('clamps each conversation request to the configured output ceiling', async () => {
    const ctx = await harness({ maxOutputTokensPerTurn: 128 })
    ctx.tools.register(defineContentToolFixture({
      name: 'ping',
      description: 'p',
      parameters: {},
      async execute() { return [{ type: 'text', text: 'ok' }] },
    }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'ping', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('cap-tokens'), {
      provider: 'mock',
      model: 'mock',
      maxTokens: 8_192,
    })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'go' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(ctx, agent)

    expect(adapter.requests.map(request => request.maxTokens)).toEqual([128, 128])
  }, 60_000)

  it('preserves an already-stricter agent maxTokens', async () => {
    const ctx = await harness({ maxOutputTokensPerTurn: 1_000 })
    const adapter = new MockAdapter([textResponse('ok')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('cap-preserve'), {
      provider: 'mock',
      model: 'mock',
      maxTokens: 64,
    })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'go' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests[0]?.maxTokens).toBe(64)
  }, 60_000)
})
