/**
 * Unit tests for recallable multi-checkpoint pass planning, stub commit order,
 * and mid-commit resume.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@maple/cordis'
import RecallableCompactionEngine, {
  isIncompleteRecallablePass,
  listSurfaceCheckpoints,
  planPassRegions,
  selectCompactableRange,
  summaryCheckpointKind,
} from '@maple/compaction-recallable'
import type { RecallableCompactionConfig } from '@maple/compaction-recallable'
import type { RecallableSummarizationInput } from '@maple/compaction-recallable/src/summarizer.ts'
import type { SummaryResult } from '@maple/compaction-basic/src/summarizer.ts'
import { CompactionId } from '@maple/compaction'
import LlmRuntime, { createUserMessage, createMessage, LlmAdapter } from '@maple/llm'
import type { ContentBlock, LlmResolvedModelInfo, StreamChunk } from '@maple/llm'
import SessionStore, { Session, SessionId } from '@maple/session'
import TokenMeter from '@maple/token-meter'
import type { Agent } from '@maple/agent'

const SIGNAL = new AbortController().signal
const MODEL = 'test-model'

class ContextAdapter extends LlmAdapter {
  constructor(private readonly contextWindow: number) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: this.contextWindow },
    })
  }

  override async * stream(): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function createContext(contextWindow = 50_000): Context {
  const ctx = new Context()
  void new LlmRuntime(ctx)
  void new TokenMeter(ctx)
  void new SessionStore(ctx)
  ctx.llm.registerAdapter([MODEL], new ContextAdapter(contextWindow))
  return ctx
}

function agent(session: Session): Agent {
  return {
    session,
    options: { provider: MODEL, model: MODEL },
  } as Agent
}

/** Closed turns followed by one open turn for durable compaction events. */
function conversation(turns: number, text = 'fixture content '.repeat(20).trim()): Session {
  const session = Session.create(SessionId(`conversation-${turns}`))
  for (let turn = 1; turn <= turns; turn += 1) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `${text} user ${turn}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn, step: 1 })
    if (turn === 1) {
      session.append('request/header', {
        header: { config: { provider: MODEL, model: MODEL } },
        reason: 'initial',
      })
    }
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: `${text} assistant ${turn}` }],
        source: { kind: 'model', provider: MODEL, model: MODEL },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  session.append('turn/start', { turn: turns + 1 })
  return session
}

class TestRecallableEngine extends RecallableCompactionEngine {
  summaryForKind: Record<'index' | 'state', ContentBlock[]> = {
    index: [{ type: 'text', text: 'stub body\nKeywords: ALPHA' }],
    state: [{ type: 'text', text: '## Primary Request and Intent\n- small state' }],
  }

  calls: RecallableSummarizationInput[] = []

  override async summarize(
    input: RecallableSummarizationInput,
    _agent: Agent,
    _signal?: AbortSignal,
  ): Promise<SummaryResult> {
    this.calls.push(input)
    return {
      summary: this.summaryForKind[input.kind],
      provider: 'test',
      model: 'stub-model',
      maxTokens: input.kind === 'index' ? 256 : 8192,
    }
  }
}

function service(
  config: RecallableCompactionConfig = { auto: false, chunkTokens: 80, stubTokens: 16 },
  ctx = createContext(),
): TestRecallableEngine {
  return new TestRecallableEngine(ctx, config)
}

describe('recallable config and planning', () => {
  it('rejects stubTokens that violate the chunk ratio ceiling', () => {
    expect(() => service({ auto: false, chunkTokens: 100, stubTokens: 40 })).toThrow(/ratio/)
  })

  it('plans index stubs before a trailing state region for a long span', () => {
    const session = conversation(6)
    const ctx = createContext()
    const measurement = ctx.tokenMeter.measure(session)
    const range = selectCompactableRange(session, measurement, 0)
    expect(range).not.toBeNull()
    const plan = planPassRegions(session, measurement, range!.start, range!.end, 80)
    expect(plan.state.role).toBe('state')
    expect(plan.stubs.every(region => region.role === 'index')).toBe(true)
    expect(plan.all.at(-1)).toEqual(plan.state)
    expect(plan.stubs.length).toBeGreaterThanOrEqual(1)
  })
})

describe('stub commit order', () => {
  it('commits index stubs left-to-right then the state checkpoint', async () => {
    const session = conversation(8, 'long fixture payload '.repeat(30).trim())
    const compact = service({ auto: false, chunkTokens: 120, stubTokens: 20, retainTokens: 0 })
    const nodes = session.surface.nodes
    const result = await compact.compactRegion(nodes[0]!, nodes.at(-1)!, agent(session), SIGNAL)

    const summaries = session.events.filter(event => event.type === 'compaction/summary')
    expect(summaries.length).toBeGreaterThanOrEqual(2)
    const kinds = summaries.map(event =>
      event.type === 'compaction/summary' ? summaryCheckpointKind(event) : null)
    expect(kinds.filter(kind => kind === 'index').length).toBeGreaterThanOrEqual(1)
    expect(kinds.at(-1)).toBe('state')

    const surface = listSurfaceCheckpoints(session)
    expect(surface.map(checkpoint => checkpoint.kind).at(-1)).toBe('state')
    const indexIdx = surface.filter(checkpoint => checkpoint.kind === 'index').map(c => c.surfaceIdx)
    const stateIdx = surface.find(checkpoint => checkpoint.kind === 'state')?.surfaceIdx
    expect(stateIdx).toBeDefined()
    for (const idx of indexIdx) {
      expect(idx).toBeLessThan(stateIdx!)
    }

    expect(result.shadowedSeqs.length).toBeGreaterThan(0)
    expect(summaries.at(-1)).toBeDefined()
    const stateText = JSON.stringify(session.events[surface.at(-1)!.seq])
    expect(stateText).toContain('<compacted-summary>')
    expect(stateText).toContain('history_read')
    const stubText = JSON.stringify(session.events[surface[0]!.seq])
    expect(stubText).toContain('<compacted-index-stub>')
  })
})

describe('crash mid-commit resume', () => {
  it('detects an incomplete stub prefix and resumes the state rewrite', async () => {
    const session = conversation(8, 'resume fixture '.repeat(40).trim())
    const ctx = createContext()
    const engine = service({ auto: false, chunkTokens: 100, stubTokens: 16, retainTokens: 0 }, ctx)
    const nodes = session.surface.nodes
    const measurement = ctx.tokenMeter.measure(session)
    const range = selectCompactableRange(session, measurement, 0)!
    const plan = planPassRegions(session, measurement, range.start, range.end, 100)
    expect(plan.stubs.length).toBeGreaterThanOrEqual(1)

    // Fully commit the first stub, then crash as the next region opens.
    let compactionStarts = 0
    const spyAppend = session.append.bind(session)
    session.append = ((
      type: Parameters<Session['append']>[0],
      data: Parameters<Session['append']>[1],
      options?: Parameters<Session['append']>[2],
    ) => {
      if (type === 'compaction/start') {
        compactionStarts += 1
        if (compactionStarts === 2) {
          throw new Error('injected mid-commit crash before second region')
        }
      }
      return options === undefined
        ? spyAppend(type, data)
        : spyAppend(type, data, options)
    }) as typeof session.append

    await expect(
      engine.compactRegion(nodes[0]!, nodes.at(-1)!, agent(session), SIGNAL),
    ).rejects.toThrow(/mid-commit crash/)

    session.append = spyAppend

    const surfaceKinds = listSurfaceCheckpoints(session).map(c => c.kind)
    expect(surfaceKinds).toContain('index')
    expect(surfaceKinds.includes('state')).toBe(false)
    expect(isIncompleteRecallablePass(session)).toBe(true)

    const liveRange = selectCompactableRange(session, ctx.tokenMeter.measure(session), 0)
    expect(liveRange).not.toBeNull()
    await engine.compactRegion(liveRange!.start, liveRange!.end, agent(session), SIGNAL)

    const finalKinds = listSurfaceCheckpoints(session).map(c => c.kind)
    expect(finalKinds.filter(kind => kind === 'index').length).toBeGreaterThanOrEqual(1)
    expect(finalKinds.at(-1)).toBe('state')
    expect(isIncompleteRecallablePass(session)).toBe(false)
  })
})

describe('legacy state adoption', () => {
  it('treats summaries without kind as state-class', () => {
    const session = Session.create(SessionId('legacy'))
    session.append('compaction/summary', {
      compactionId: CompactionId('00000000-0000-4000-8000-000000000001'),
      summary: [{ type: 'text', text: 'legacy' }],
      shadowedRange: { start: 1, end: 2 },
      shadowedSeqs: [1, 2],
      shadowedTokenCount: 10,
      provider: 'x',
      model: 'y',
    })
    const event = session.events.find(e => e.type === 'compaction/summary')!
    expect(summaryCheckpointKind(event as never)).toBe('state')
  })
})
