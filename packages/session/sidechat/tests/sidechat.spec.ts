import { describe, expect, it } from 'vitest'
import { Context } from '@maple/cordis'
import { createUserMessage, CallId } from '@maple/llm'
import { SessionId } from '@maple/session'
import type { SessionEvent } from '@maple/session'
import { defineContentToolFixture } from '@maple/tools'
import type { Agent } from '@maple/agent'
import AgentLoop from '@maple/agent-loop'
import { mountAgentLoopTestDependencies } from '@maple/agent-loop-testkit'
import SidechatService, {
  ADVISOR_FRAMING_TEXT,
  DEFAULT_MERGE_MAX_CHARS,
  SIDECHAT_PLUGIN,
  SIDECHAT_READONLY_DENY_REASON,
  SidechatForkError,
  SidechatMergeError,
  capMergeNote,
  completedTurnSeedLength,
} from '@maple/sidechat'
import {
  MockAdapter,
  textResponse,
  toolCallResponse,
  type HangAfter,
} from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { StreamChunk, GenerateOptions } from '@maple/llm'

const testToolSignal = new AbortController().signal

type ScriptEntry = StreamChunk[] | ((options: GenerateOptions) => StreamChunk[]) | 'hang' | 'hang-slow' | HangAfter

async function harness(
  config: { mergeMaxChars?: number } = {},
  responses: ScriptEntry[] = [textResponse('parent answer')],
): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SidechatService, {
    mergeMaxChars: config.mergeMaxChars ?? DEFAULT_MERGE_MAX_CHARS,
  })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(responses))
  ctx.tools.register(defineContentToolFixture({
    name: 'read_probe',
    description: 'read-only',
    parameters: {},
    isConcurrencySafe: () => true,
    async execute() { return [{ type: 'text', text: 'read-ok' }] },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'write_probe',
    description: 'mutating',
    parameters: {},
    async execute() { return [{ type: 'text', text: 'write-ok' }] },
  }))
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

async function parentWithCompletedTurn(ctx: Context, id = 'parent'): Promise<Agent> {
  const agent = ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'parent prompt' }],
    source: { kind: 'user' },
  }))
  await waitForIdle(ctx, agent)
  return agent
}

/** First plugin-sourced sidechat framing after the inherited seed boundary. */
function framingAfterSeed(child: Agent): SessionEvent<'user/message'> | undefined {
  const seedLength = child.session.header.seedLength ?? 0
  return child.session.events.slice(seedLength).find(
    (event): event is SessionEvent<'user/message'> =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === SIDECHAT_PLUGIN,
  )
}

describe('completedTurnSeedLength', () => {
  it('returns undefined before any completed turn', () => {
    expect(completedTurnSeedLength([])).toBeUndefined()
  })

  it('selects the last completed turn and trailing standalone events', async () => {
    const ctx = await harness()
    const parent = await parentWithCompletedTurn(ctx)
    const cut = completedTurnSeedLength(parent.session.events)
    expect(cut).toBe(parent.session.events.length)
    expect(parent.session.events[cut! - 1]?.type).not.toBe('turn/start')
  })
})

describe('capMergeNote', () => {
  it('ellipsizes when over the cap', () => {
    expect(capMergeNote('abcdefghij', 5)).toBe('abcd…')
  })
})

describe('SidechatService.fork / mergeBack', () => {
  it('forks a sidechat child with lineage, framing, and an untouched parent', async () => {
    const ctx = await harness()
    const parent = await parentWithCompletedTurn(ctx)
    const parentLen = parent.session.events.length
    const childId = SessionId('sidechat-child')

    const handle = await ctx.sidechat.fork(parent, { sessionId: childId })
    const child = handle.agent

    expect(parent.session.events).toHaveLength(parentLen)
    expect(child.session.header).toMatchObject({
      parentSession: parent.id,
      seedLength: parentLen,
      origin: 'sidechat',
    })
    expect(child.session.events.slice(0, parentLen)).toEqual(parent.session.events)
    const framing = framingAfterSeed(child)
    expect(framing).toBeDefined()
    expect(framing!.data.source).toMatchObject({ kind: 'plugin', plugin: SIDECHAT_PLUGIN })
    expect(framing!.data.content).toEqual([{ type: 'text', text: ADVISOR_FRAMING_TEXT }])
    // Framing is the only sidechat notice after the seed boundary (end-seed may precede it).
    const afterSeed = child.session.events.slice(parentLen)
    expect(afterSeed.filter(event => event.type === 'user/message')).toHaveLength(1)
  })

  it('rejects a fork with no completed turn', async () => {
    const ctx = await harness({}, [])
    const empty = ctx.agentLoop.create(SessionId('empty'), { provider: 'mock', model: 'mock' })
    await expect(ctx.sidechat.fork(empty)).rejects.toBeInstanceOf(SidechatForkError)
  })

  it('merges a capped note into the parent at the log tip', async () => {
    const ctx = await harness({ mergeMaxChars: 12 })
    const parent = await parentWithCompletedTurn(ctx)
    const handle = await ctx.sidechat.fork(parent, { sessionId: SessionId('merge-child') })
    const before = parent.session.events.length

    const message = ctx.sidechat.mergeBack(parent, handle.agent, 'abcdefghijklmnopqrstuvwxyz')
    expect(message.source).toMatchObject({ kind: 'plugin', plugin: SIDECHAT_PLUGIN })
    expect(parent.session.events).toHaveLength(before + 1)
    const appended = parent.session.events.at(-1)
    expect(appended?.type).toBe('user/message')
    if (appended?.type !== 'user/message') throw new Error('expected merge message')
    const text = appended.data.content.map(block => block.type === 'text' ? block.text : '').join('')
    expect(text).toContain('Side-session handback:')
    expect(text).toContain('abcdefghijk…')
    expect(text).not.toContain('abcdefghijklmnopqrstuvwxyz')
  })

  it('defaults merge-back note to the child latest assistant text', async () => {
    const ctx = await harness({}, [
      textResponse('parent answer'),
      textResponse('child conclusion'),
    ])
    const parent = await parentWithCompletedTurn(ctx)
    const handle = await ctx.sidechat.fork(parent, { sessionId: SessionId('assist-child') })
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'advise' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(ctx, handle.agent)

    ctx.sidechat.mergeBack(parent, handle.agent)
    const appended = parent.session.events.at(-1)
    expect(appended?.type).toBe('user/message')
    if (appended?.type !== 'user/message') throw new Error('expected merge message')
    const text = appended.data.content.map(block => block.type === 'text' ? block.text : '').join('')
    expect(text).toContain('child conclusion')
  })

  it('rejects merge-back without lineage or note', async () => {
    const ctx = await harness({}, [
      textResponse('parent-a'),
      textResponse('parent-b'),
    ])
    const parent = await parentWithCompletedTurn(ctx, 'merge-parent')
    const other = await parentWithCompletedTurn(ctx, 'other-parent')
    const handle = await ctx.sidechat.fork(parent, { sessionId: SessionId('bad-merge-child') })
    expect(() => ctx.sidechat.mergeBack(other, handle.agent, 'x')).toThrow(SidechatMergeError)
    expect(() => ctx.sidechat.mergeBack(parent, handle.agent, '   ')).toThrow(SidechatMergeError)
  })
})

describe('sidechat read-only deny gate', () => {
  it('allows concurrency-safe tools and denies mutating tools', async () => {
    const ctx = await harness()
    const parent = await parentWithCompletedTurn(ctx)
    const handle = await ctx.sidechat.fork(parent, { sessionId: SessionId('deny-child') })
    const child = handle.agent

    const allowed = await ctx.tools.execute({
      callId: CallId('r1'),
      name: 'read_probe',
      arguments: {},
      signal: testToolSignal,
      agent: child,
    })
    expect(allowed.isError).toBe(false)

    const denied = await ctx.tools.execute({
      callId: CallId('w1'),
      name: 'write_probe',
      arguments: {},
      signal: testToolSignal,
      agent: child,
    })
    expect(denied.isError).toBe(true)
    expect(denied.content.some(block => block.type === 'text' && block.text.includes(SIDECHAT_READONLY_DENY_REASON))).toBe(true)

    const parentWrite = await ctx.tools.execute({
      callId: CallId('pw1'),
      name: 'write_probe',
      arguments: {},
      signal: testToolSignal,
      agent: parent,
    })
    expect(parentWrite.isError).toBe(false)
  })

  it('denies a mutating tool call through the agent loop', async () => {
    const ctx = await harness({}, [
      textResponse('parent answer'),
      toolCallResponse('c1', 'write_probe', {}),
      textResponse('understood'),
    ])
    const parent = await parentWithCompletedTurn(ctx)
    const handle = await ctx.sidechat.fork(parent, { sessionId: SessionId('loop-deny') })
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'try write' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(ctx, handle.agent)
    const result = handle.agent.session.events.find(event => event.type === 'tool/result')
    expect(result?.type).toBe('tool/result')
    if (result?.type !== 'tool/result') throw new Error('expected tool result')
    const toolBlock = result.data.message.content[0]
    expect(toolBlock?.type).toBe('tool-result')
    if (toolBlock?.type !== 'tool-result') throw new Error('expected tool-result block')
    expect(toolBlock.isError).toBe(true)
    const text = toolBlock.content
      .map(inner => inner.type === 'text' ? inner.text : '')
      .join('')
    expect(text).toContain(SIDECHAT_READONLY_DENY_REASON)
  })
})
