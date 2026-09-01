import { describe, expect, it } from 'vitest'
import { Context } from '@maple/cordis'
import { CallId, createMessage, createToolResultMessage, createUserMessage } from '@maple/llm'
import SystemPrompt from '@maple/system-prompt'
import ToolRuntime from '@maple/tools'
import { Session, SessionId } from '@maple/session'
import type { Agent } from '@maple/agent'
import { CompactionId } from '@maple/compaction'
import * as tool from '../src/index.ts'

const testSignal = new AbortController().signal

function agentWithSession(session: Session): Agent & { session: Session } {
  return { id: session.id, session } as unknown as Agent & { session: Session }
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool)
  return ctx
}

let callCounter = 0
function executeTool(ctx: Context, name: string, args: unknown, agent: Agent) {
  return ctx.tools.execute({
    signal: testSignal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
    agent,
  })
}

function getText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('@maple/tool-recall', () => {
  it('registers history_read and history_search tool schemas', async () => {
    const ctx = await setup()
    const schemas = ctx.tools.schemas()
    expect(schemas.some(s => s.name === 'history_read')).toBe(true)
    expect(schemas.some(s => s.name === 'history_search')).toBe(true)
  })

  it('rejects execution when agent is not present', async () => {
    const ctx = await setup()
    const result = await ctx.tools.execute({
      signal: testSignal,
      callId: CallId('call-no-agent'),
      name: 'history_read',
      arguments: { checkpoint: 'c1' },
    })
    expect(getText(result)).toContain('Error: history_read requires an active agent session.')
  })

  it('handles missing checkpoints gracefully', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('test-sess'))
    const agent = agentWithSession(session)

    const result = await executeTool(ctx, 'history_read', { checkpoint: 'c999' }, agent)
    expect(getText(result)).toContain('Checkpoint "c999" not found in session history.')
  })

  it('reads shadowed conversation span using history_read', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('test-sess'))
    const agent = agentWithSession(session)

    // Append some historical events
    session.append('turn/start', { turn: 1 }) // seq 0
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Please configure database connection' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' }) // seq 1
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Database configured with DB_PORT=5432' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      }),
    }, { surfaceOp: 'append' }) // seq 2
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c1'), name: 'read_file', arguments: '{"path":"config.json"}' }) // seq 3
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('c1'),
        content: [{ type: 'text', text: '{"port": 5432}' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' }) // seq 4
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }) // seq 5

    // Append compaction/summary event shadowing seqs 1..4
    session.append('compaction/summary', {
      compactionId: CompactionId('comp-1'),
      summary: [{ type: 'text', text: 'Configured DB port 5432' }],
      shadowedRange: { start: 1, end: 4 },
      shadowedSeqs: [1, 2, 3, 4],
      shadowedTokenCount: 150,
      provider: 'deepseek',
      model: 'deepseek-chat',
    })

    const summarySeq = session.events[session.events.length - 1]!.seq

    const readResult = await executeTool(ctx, 'history_read', { checkpoint: `c${summarySeq}` }, agent)
    const text = getText(readResult)
    expect(text).toContain('Please configure database connection')
    expect(text).toContain('Database configured with DB_PORT=5432')
    expect(text).toContain('read_file')
    expect(text).toContain('{"port": 5432}')
  })

  it('searches across shadowed history using history_search', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('test-sess'))
    const agent = agentWithSession(session)

    // Append historical events
    session.append('turn/start', { turn: 1 }) // seq 0
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Secret token is XYZ987' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' }) // seq 1
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Token stored securely' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      }),
    }, { surfaceOp: 'append' }) // seq 2
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }) // seq 3

    // Append compaction/summary event shadowing seqs 1..2
    session.append('compaction/summary', {
      compactionId: CompactionId('comp-1'),
      summary: [{ type: 'text', text: 'Saved token' }],
      shadowedRange: { start: 1, end: 2 },
      shadowedSeqs: [1, 2],
      shadowedTokenCount: 50,
      provider: 'deepseek',
      model: 'deepseek-chat',
    })

    const searchHit = await executeTool(ctx, 'history_search', { query: 'XYZ987' }, agent)
    expect(getText(searchHit)).toContain('Secret token is XYZ987')
    expect(getText(searchHit)).toContain('Found 1 matching snippet(s)')

    const searchMiss = await executeTool(ctx, 'history_search', { query: 'NONEXISTENT_VAL' }, agent)
    expect(getText(searchMiss)).toContain('No matches found for "NONEXISTENT_VAL"')
  })
})
