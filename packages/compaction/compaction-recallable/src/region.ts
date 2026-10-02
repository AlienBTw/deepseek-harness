/**
 * Frozen-aware range selection and multi-checkpoint compaction transactions.
 *
 * A pass summarizes all planned regions concurrently, applies the inflation
 * guard (unless resuming a mid-commit prefix), then commits left to right:
 * index stubs first, state rewrite last.
 *
 * @module @maple/compaction-recallable/region
 */

import { randomUUID } from 'node:crypto'
import {
  CompactionId,
  ManualCompactionError,
  compactCheckpointSource,
  toolPairingBalancedAfter,
  toolPairingBalancedBefore,
} from '@maple/compaction'
import type { CompactionResult } from '@maple/compaction'
import type { CommandId } from '@maple/commands/brand'
import { createUserMessage, errorChain } from '@maple/llm'
import type { ContentBlock, Message } from '@maple/llm'
import type { TokenMeasurement, TokenMeter } from '@maple/token-meter'
import type { Session, SessionEvent } from '@maple/session'
import type { Agent } from '@maple/agent'
import type { SummarizationInput, SummaryResult } from '@maple/compaction-basic/src/summarizer.ts'
import {
  isIncompleteRecallablePass,
  latestStateSummary,
  listSurfaceCheckpoints,
} from './checkpoint-class.ts'
import { planPassRegions, selectCompactableRange, type PlannedRegion } from './chunk.ts'
import {
  codeOnlyPointerStub,
  extractKeywordLine,
  frameRecallableSummary,
  summaryPlainText,
  type RecallableSummarizationInput,
} from './summarizer.ts'
import type { CheckpointKind } from './types.ts'

export { selectCompactableRange }

interface RegionDependencies {
  readonly meter: TokenMeter
  readonly chunkTokens: number
  readonly stubTokens: number
  readonly stateMaxTokens: number
  summarize(
    input: RecallableSummarizationInput,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<SummaryResult>
}

/** One validated inclusive span of current surface positions. */
interface SurfaceSelection {
  readonly start: number
  readonly end: number
  readonly startIdx: number
  readonly endIdx: number
  readonly shadowedSeqs: readonly number[]
}

interface CompactionTransactionOptions {
  readonly owner: 'current-turn' | null
  readonly stability: 'whole-surface' | 'selected-span'
  readonly flush?: () => Promise<void>
  readonly sourceCommandId?: CommandId
  /** Skip the inflation guard when finishing a mid-commit resume. */
  readonly skipInflationGuard?: boolean
}

interface CompactionEntryState {
  readonly openTurn: number | null
  readonly unmatchedCompactionStart: SessionEvent<'compaction/start'> | undefined
  readonly latestEndSeedSeq: number | undefined
}

class SurfaceChangedError extends Error {}
class InflationGuardError extends Error {}

interface BufferedRegion {
  readonly planned: PlannedRegion
  readonly prepared: {
    readonly measurement: TokenMeasurement
    readonly selectedNodes: TokenMeasurement['nodes']
    readonly shadowedTokenCount: number
    readonly input: RecallableSummarizationInput
  }
  readonly summary: SummaryResult
  readonly framedTokenCount: number
}

/**
 * Run one recallable pass over an inclusive surface span: plan stub+state
 * regions, summarize concurrently, guard inflation, commit left to right.
 * @param dependencies - meter, budgets, and summarizer hook.
 * @param session - session whose surface is mutated.
 * @param start - inclusive first surface-node seq.
 * @param end - inclusive last surface-node seq.
 * @param agent - agent used by the summarizer.
 * @param options - bracket owner, stability rule, and optional durability checkpoint.
 * @param signal - optional summarization cancellation signal.
 * @returns the final (state) compaction result.
 */
export async function compactSurfaceRegion(
  dependencies: RegionDependencies,
  session: Session,
  start: number,
  end: number,
  agent: Agent,
  options: CompactionTransactionOptions,
  signal?: AbortSignal,
): Promise<CompactionResult> {
  if (options.owner === null) signal?.throwIfAborted()
  validateSurfaceRegion(session, start, end)
  const entryState = inspectCompactionEntryState(session.events)
  assertCompactionInactive(
    entryState.unmatchedCompactionStart,
    entryState.latestEndSeedSeq,
    'compaction',
  )

  const measurement = dependencies.meter.measure(session)
  const plan = planPassRegions(
    session,
    measurement,
    start,
    end,
    dependencies.chunkTokens,
  )
  const resume = options.skipInflationGuard === true || isIncompleteRecallablePass(session)
  const passStartState = readPassStartStateText(session)
  const preTotalTokens = measurement.totalTokens

  const buffered = await Promise.all(plan.all.map(async (planned, index) => {
    const prepared = prepareRegion(dependencies, session, planned, passStartState, [])
    let summary: SummaryResult
    if (planned.role === 'index' && regionIsRecalledContent(session, planned)) {
      summary = {
        summary: codeOnlyPointerStub({ start: planned.start, end: planned.end }),
        provider: 'code',
        model: 'pointer-stub',
      }
    } else {
      try {
        summary = await dependencies.summarize(prepared.input, agent, signal)
      } catch (error: unknown) {
        if (planned.role !== 'index') throw error
        summary = {
          summary: codeOnlyPointerStub({ start: planned.start, end: planned.end }),
          provider: 'code',
          model: 'pointer-stub-fallback',
        }
      }
    }
    // Predicted framed size uses a provisional seq; commit reframes with the real seq.
    const provisionalSeq = session.seq + index
    const framed = frameRecallableSummary(
      summary.summary,
      provisionalSeq,
      { start: planned.start, end: planned.end },
      planned.role,
    )
    const framedTokenCount = dependencies.meter.estimateMessage(createUserMessage({
      content: framed,
      source: compactCheckpointSource(CompactionId(randomUUID())),
    }))
    return {
      planned,
      prepared,
      summary,
      framedTokenCount,
    } satisfies BufferedRegion
  }))

  // Refresh keyword / recent-stub layering is advisory for the LLM; concurrent
  // calls already ran. Recompute post size from buffered framed tokens.
  const shadowedTotal = buffered.reduce((total, region) => total + region.prepared.shadowedTokenCount, 0)
  const framedTotal = buffered.reduce((total, region) => total + region.framedTokenCount, 0)
  const postTotalTokens = preTotalTokens - shadowedTotal + framedTotal
  if (!resume && postTotalTokens >= preTotalTokens) {
    throw new InflationGuardError(
      `inflation guard: compaction would not reduce total context (${postTotalTokens} estimated tokens >= ${preTotalTokens})`,
    )
  }

  let lastResult: CompactionResult | undefined
  for (const region of buffered) {
    // Re-resolve the planned span against the live surface after prior replaces.
    const live = relocateRegion(session, region.planned)
    lastResult = await commitOneRegion(
      dependencies,
      session,
      live,
      region.summary,
      region.planned.role,
      agent,
      {
        ...options,
        skipInflationGuard: true, // pass-level guard already applied
      },
      signal,
    )
  }
  /* v8 ignore next -- every successful path commits at least the state region. */
  if (lastResult === undefined) throw new Error('recallable compaction committed no regions')
  return lastResult
}

/**
 * Reject a durable unmatched compaction marker unless a later constructor-seed
 * boundary proves that its owner belongs to an earlier session lifecycle.
 */
function assertCompactionInactive(
  unmatchedCompactionStart: SessionEvent<'compaction/start'> | undefined,
  latestEndSeedSeq: number | undefined,
  stage: string,
): void {
  if (unmatchedCompactionStart === undefined
    || (latestEndSeedSeq !== undefined
      && latestEndSeedSeq > unmatchedCompactionStart.seq)) return
  throw new ManualCompactionError(
    'busy',
    `${stage}: compaction already in progress; the session compaction lock is already active`,
  )
}

/**
 * Recheck the durable compaction lock after an asynchronous policy decision.
 * @param session - session whose latest marker state is inspected.
 * @param stage - operation label included in the busy diagnostic.
 */
export function assertNoActiveCompaction(session: Session, stage: string): void {
  const entryState = inspectCompactionEntryState(session.events)
  assertCompactionInactive(
    entryState.unmatchedCompactionStart,
    entryState.latestEndSeedSeq,
    stage,
  )
}

/** Validate one requested surface-position span before asynchronous work begins. */
function validateSurfaceRegion(session: Session, start: number, end: number): SurfaceSelection {
  const nodes = session.surface.nodes
  const startIdx = nodes.indexOf(start)
  const endIdx = nodes.indexOf(end)
  if (startIdx === -1) throw new Error(`compactRegion: start seq ${start} not found in surface`)
  if (endIdx === -1) throw new Error(`compactRegion: end seq ${end} not found in surface`)
  if (startIdx > endIdx) {
    throw new Error(
      `compactRegion: start seq ${start} (position ${startIdx}) is after end seq ${end} (position ${endIdx}) on the surface`,
    )
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion
  if (!toolPairingBalancedBefore(session, nodes[startIdx]!)) {
    throw new Error(`compactRegion: start seq ${start} is not a balanced boundary (would split a step's tool-call/result pair)`)
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion
  if (!toolPairingBalancedAfter(session, nodes[endIdx]!)) {
    throw new Error(`compactRegion: end seq ${end} is not a balanced boundary (would split a step, or the step is still open)`)
  }

  return { start, end, startIdx, endIdx, shadowedSeqs: nodes.slice(startIdx, endIdx + 1) }
}

/** After prior left-to-right replaces, re-bind a planned region by remaining seq identity. */
function relocateRegion(session: Session, planned: PlannedRegion): SurfaceSelection {
  const nodes = session.surface.nodes
  const remaining = planned.shadowedSeqs.filter(seq => nodes.includes(seq))
  if (remaining.length === 0) {
    throw new SurfaceChangedError('compaction: planned region no longer present on the surface')
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const start = remaining[0]!
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const end = remaining.at(-1)!
  return validateSurfaceRegion(session, start, end)
}

/** Snapshot pricing and replay input for one planned region. */
function prepareRegion(
  dependencies: RegionDependencies,
  session: Session,
  planned: PlannedRegion,
  passStartState: string | undefined,
  priorKeywords: readonly string[],
): BufferedRegion['prepared'] {
  const selection = validateSurfaceRegion(session, planned.start, planned.end)
  const measurement = dependencies.meter.measure(session)
  const selectedNodes = measurement.nodes.slice(selection.startIdx, selection.endIdx + 1)
  if (selectedNodes.length !== selection.shadowedSeqs.length
    || selectedNodes.some((node, index) => node.seq !== selection.shadowedSeqs[index])) {
    throw new SurfaceChangedError('compaction: selected surface changed before summarization began')
  }
  const base = buildSummarizationInput(session, selection.shadowedSeqs)
  const input: RecallableSummarizationInput = {
    ...base,
    kind: planned.role,
    ...passStartState === undefined ? {} : { passStartState },
    ...priorKeywords.length === 0 ? {} : { priorStubKeywords: priorKeywords },
  }
  return {
    measurement,
    selectedNodes,
    shadowedTokenCount: selectedNodes.reduce((total, node) => total + node.tokens, 0),
    input,
  }
}

/** Commit one buffered region as its own start/summary/replace/end bracket. */
async function commitOneRegion(
  dependencies: RegionDependencies,
  session: Session,
  selection: SurfaceSelection,
  summaryResult: SummaryResult,
  kind: CheckpointKind,
  agent: Agent,
  options: CompactionTransactionOptions,
  signal?: AbortSignal,
): Promise<CompactionResult> {
  if (options.owner === null) signal?.throwIfAborted()
  const entryState = inspectCompactionEntryState(session.events)
  assertCompactionInactive(
    entryState.unmatchedCompactionStart,
    entryState.latestEndSeedSeq,
    'compaction',
  )

  let owner: number | null
  if (options.owner === null) {
    if (entryState.openTurn !== null) {
      throw new ManualCompactionError('busy', 'manual compaction: the session already has an open turn')
    }
    owner = null
  } else {
    if (entryState.openTurn === null) {
      throw new Error('compactRegion: no open turn — automatic compaction events must be enclosed in a turn')
    }
    owner = entryState.openTurn
  }

  const compactionId = CompactionId(randomUUID())
  const lifecycle = {
    compactionId,
    ...options.sourceCommandId === undefined ? {} : { sourceCommandId: options.sourceCommandId },
    turn: owner,
  }
  const startEvent = session.append('compaction/start', lifecycle)
  let failure: { error: unknown; stage: 'summary' | 'commit' } | undefined
  let flushFailure: unknown
  let result: CompactionResult | undefined
  let closed = false
  let closing = false
  let stage: 'summary' | 'commit' = 'summary'

  try {
    const measurement = dependencies.meter.measure(session)
    const selectedNodes = measurement.nodes.slice(selection.startIdx, selection.endIdx + 1)
    const shadowedTokenCount = selectedNodes.reduce((total, node) => total + node.tokens, 0)
    const framedPreview = frameRecallableSummary(
      summaryResult.summary,
      session.seq,
      { start: selection.start, end: selection.end },
      kind,
    )
    const framedSummaryTokenCount = dependencies.meter.estimateMessage(createUserMessage({
      content: framedPreview,
      source: compactCheckpointSource(compactionId, options.sourceCommandId),
    }))
    if (framedSummaryTokenCount >= shadowedTokenCount && options.skipInflationGuard !== true) {
      throw new Error(
        `summary is not smaller than the shadowed content (${framedSummaryTokenCount} estimated framed tokens >= ${shadowedTokenCount})`,
      )
    }
    stage = 'commit'
    const pending = commitCompactionBody(
      session,
      startEvent,
      {
        start: selection.start,
        end: selection.end,
        shadowedSeqs: selection.shadowedSeqs,
        shadowedTokenCount,
        kind,
        ...summaryResult,
      },
    )
    closing = true
    session.append('compaction/end', lifecycle)
    closed = true
    result = pending
  } catch (error: unknown) {
    failure = { error, stage: closing ? 'commit' : stage }
    if (!closing) {
      closing = true
      try {
        session.append('compaction/end', { ...lifecycle, error: errorChain(error) })
        closed = true
      } catch (closeError: unknown) {
        failure = { error: closeError, stage: 'commit' }
      }
    }
  }

  if (closed && options.flush !== undefined) {
    try {
      await options.flush()
    } catch (error: unknown) {
      flushFailure = error
    }
  }

  if (options.owner === null) signal?.throwIfAborted()
  if (failure !== undefined) {
    if (options.owner === null) throwManualFailure(failure)
    throw failure.error
  }
  if (flushFailure !== undefined) {
    throw new ManualCompactionError(
      'persistence',
      'manual compaction durability checkpoint failed',
      { cause: flushFailure },
    )
  }
  /* v8 ignore next -- every path without a result records and throws a failure above. */
  if (result === undefined) throw new Error('compaction committed without a result')
  // Silence unused agent in this path; summarize already completed.
  void agent
  return result
}

/** Classify one closed manual attempt without weakening cancellation precedence. */
function throwManualFailure(failure: { error: unknown; stage: 'summary' | 'commit' }): never {
  if (failure.stage === 'commit') {
    throw new ManualCompactionError(
      'commit',
      'manual compaction did not commit cleanly',
      { cause: failure.error },
    )
  }
  if (failure.error instanceof SurfaceChangedError) {
    throw new ManualCompactionError(
      'changed',
      'the compacted history changed during manual compaction',
      { cause: failure.error },
    )
  }
  throw new ManualCompactionError(
    'summary',
    'manual compaction could not produce a smaller summary',
    { cause: failure.error },
  )
}

type CommitBodyInput = SummaryResult & {
  readonly start: number
  readonly end: number
  readonly shadowedSeqs: readonly number[]
  readonly shadowedTokenCount: number
  readonly kind: CheckpointKind
}

/** Append one completed summary record and replacement body without yielding. */
function commitCompactionBody(
  session: Session,
  startEvent: SessionEvent<'compaction/start'>,
  summarized: CommitBodyInput,
): CompactionResult {
  const {
    start,
    end,
    shadowedSeqs,
    shadowedTokenCount,
    summary,
    provider,
    model,
    maxTokens,
    usage,
    kind,
  } = summarized
  const callProvenance = summarized.llmStreamCall === true
    ? { rawOutput: summarized.rawOutput, llmStreamCall: true as const }
    : summarized.rawOutput === undefined ? {} : { rawOutput: summarized.rawOutput }
  const summaryEvent = session.append('compaction/summary', {
    compactionId: startEvent.data.compactionId,
    ...startEvent.data.sourceCommandId === undefined
      ? {}
      : { sourceCommandId: startEvent.data.sourceCommandId },
    summary,
    kind,
    ...callProvenance,
    shadowedRange: { start, end },
    shadowedSeqs: [...shadowedSeqs],
    shadowedTokenCount,
    provider,
    model,
    ...maxTokens === undefined ? {} : { maxTokens },
    ...usage === undefined ? {} : { usage },
  })
  const checkpointMessage = createUserMessage({
    content: frameRecallableSummary(summary, summaryEvent.seq, { start, end }, kind),
    source: compactCheckpointSource(startEvent.data.compactionId, startEvent.data.sourceCommandId),
  })
  session.append('user/message', checkpointMessage, {
    surfaceOp: { op: 'replace', start, end },
    sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...shadowedSeqs],
  })
  return {
    compactionId: startEvent.data.compactionId,
    ...startEvent.data.sourceCommandId === undefined
      ? {}
      : { sourceCommandId: startEvent.data.sourceCommandId },
    shadowedRange: { start, end },
    shadowedSeqs: [...shadowedSeqs],
    shadowedTokenCount,
  }
}

/** Reconstruct the last routed request's cacheable prefix for the shadowed region. */
function buildSummarizationInput(
  session: Session,
  shadowedSeqs: readonly number[],
): SummarizationInput {
  const header = session.requestHeader()
  const events = session.events
  const regionMessages = shadowedSeqs
    // oxlint-disable-next-line typescript/no-non-null-assertion
    .map(seq => session.deriveEventMessage(events[seq]!))
    .filter((message): message is Message => message !== null)
  return {
    ...header?.system === undefined ? {} : { system: header.system },
    ...header?.tools === undefined ? {} : { tools: header.tools },
    messages: regionMessages,
  }
}

/** Read pass-start state text from the surface state checkpoint or latest log state. */
function readPassStartStateText(session: Session): string | undefined {
  const surface = listSurfaceCheckpoints(session).findLast(checkpoint => checkpoint.kind === 'state')
  if (surface !== undefined) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const event = session.events[surface.seq]!
    if (event.type === 'user/message') {
      const message = ('message' in event.data ? event.data.message : event.data) as {
        content: ContentBlock[]
      }
      return summaryPlainText(message.content)
    }
  }
  const logged = latestStateSummary(session)
  if (logged === undefined) return undefined
  return summaryPlainText(logged.data.summary)
}

/** Whether every surface message in the region is a history_read/search tool result. */
function regionIsRecalledContent(session: Session, planned: PlannedRegion): boolean {
  let sawRecall = false
  for (const seq of planned.shadowedSeqs) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const event = session.events[seq]!
    if (event.type === 'tool/result') {
      const name = findToolName(session, event)
      if (name !== 'history_read' && name !== 'history_search') return false
      sawRecall = true
      continue
    }
    if (event.type === 'tool/call') {
      const data = event.data as { name?: string }
      if (data.name !== 'history_read' && data.name !== 'history_search') return false
      sawRecall = true
      continue
    }
    if (event.type === 'user/message' || event.type === 'assistant/message') {
      return false
    }
  }
  return sawRecall
}

/** Resolve the tool name for a tool/result via its callId. */
function findToolName(session: Session, result: SessionEvent): string | undefined {
  const callId = (result.data as { message?: { source?: { callId?: string } }; callId?: string }).message?.source?.callId
    ?? (result.data as { callId?: string }).callId
  if (callId === undefined) return undefined
  for (let index = result.seq - 1; index >= 0; index -= 1) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const event = session.events[index]!
    if (event.type !== 'tool/call') continue
    const data = event.data as { callId?: string; name?: string }
    if (data.callId === callId) return data.name
  }
  return undefined
}

/** Inspect open-turn, unmatched-compaction, and latest seed-boundary state independently. */
function inspectCompactionEntryState(events: readonly SessionEvent[]): CompactionEntryState {
  let openTurn: number | null = null
  let openTurnStateKnown = false
  let unmatchedCompactionStart: SessionEvent<'compaction/start'> | undefined
  let compactionEntryStateKnown = false
  let latestEndSeedSeq: number | undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const event = events[index]!
    if (latestEndSeedSeq === undefined && event.type === 'session/end-seed') {
      latestEndSeedSeq = event.seq
    }
    if (!compactionEntryStateKnown) {
      if (event.type === 'compaction/start') {
        unmatchedCompactionStart = event
        compactionEntryStateKnown = true
      } else if (event.type === 'compaction/end') {
        compactionEntryStateKnown = true
      }
    }
    if (!openTurnStateKnown) {
      if (event.type === 'turn/start') {
        openTurn = event.data.turn
        openTurnStateKnown = true
      } else if (event.type === 'turn/end') {
        openTurnStateKnown = true
      }
    }
    if (openTurnStateKnown
      && compactionEntryStateKnown
      && latestEndSeedSeq !== undefined) break
  }
  return { openTurn, unmatchedCompactionStart, latestEndSeedSeq }
}

// Re-export helpers tests may need.
export {
  extractKeywordLine,
  isIncompleteRecallablePass,
  planPassRegions,
}
