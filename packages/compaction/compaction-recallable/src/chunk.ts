/**
 * Deterministic chunk planning for recallable multi-checkpoint passes.
 * @module @maple/compaction-recallable/chunk
 */

import {
  toolPairingBalancedAfter,
  toolPairingBalancedBefore,
} from '@maple/compaction'
import type { TokenMeasurement } from '@maple/token-meter'
import type { Session } from '@maple/session'
import { lastIndexStubSurfaceIdx } from './checkpoint-class.ts'

/** One inclusive surface-position span planned for a single replace. */
export interface PlannedRegion {
  readonly start: number
  readonly end: number
  readonly startIdx: number
  readonly endIdx: number
  readonly shadowedSeqs: readonly number[]
  readonly role: 'index' | 'state'
}

/** Full pass plan: zero or more index stubs followed by one state rewrite. */
export interface PassPlan {
  readonly stubs: readonly PlannedRegion[]
  readonly state: PlannedRegion
  readonly all: readonly PlannedRegion[]
}

/**
 * Resolve the next frozen-aware compactable range while retaining a priced recent
 * tail and never splitting an assistant tool-call/result pair.
 * Compactable content begins after the last committed index stub (surface head
 * when none exists). A legacy head state checkpoint is included so it can fold.
 * @param session - session supplying authoritative current surface positions.
 * @param measurement - unified pressure and surface measurement.
 * @param retainTokens - minimum recent tail budget retained verbatim.
 * @returns the inclusive positional seq range to compact, or `null`.
 */
export function selectCompactableRange(
  session: Session,
  measurement: TokenMeasurement,
  retainTokens: number,
): { start: number; end: number } | null {
  const pricedNodes = measurement.nodes
  if (pricedNodes.length === 0) return null

  const surfaceNodes = session.surface.nodes
  if (surfaceNodes.length !== pricedNodes.length
    || surfaceNodes.some((seq, index) => seq !== pricedNodes[index]?.seq)) {
    throw new Error('compaction: token-meter surface does not match the current session surface')
  }

  const afterStubIdx = lastIndexStubSurfaceIdx(session) + 1
  if (afterStubIdx >= surfaceNodes.length) return null

  let accumulated = 0
  let keepFromIdx = pricedNodes.length
  for (let index = pricedNodes.length - 1; index >= afterStubIdx; index -= 1) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    accumulated += pricedNodes[index]!.tokens
    keepFromIdx = index
    if (accumulated >= retainTokens) break
  }
  if (keepFromIdx <= afterStubIdx) return null

  while (keepFromIdx > afterStubIdx) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    if (toolPairingBalancedBefore(session, surfaceNodes[keepFromIdx]!)) break
    keepFromIdx -= 1
  }
  if (keepFromIdx <= afterStubIdx) return null

  // oxlint-disable-next-line typescript/no-non-null-assertion
  const first = surfaceNodes[afterStubIdx]!
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const cutoff = surfaceNodes[keepFromIdx - 1]!
  return { start: first, end: cutoff }
}

/**
 * Split a compactable surface span into index-stub chunks plus a trailing state slice.
 * Chunk edges snap to tool-pairing-balanced boundaries and prefer turn boundaries.
 * @param session - session supplying surface nodes and balance predicates.
 * @param measurement - priced surface nodes aligned with `session.surface`.
 * @param start - inclusive first surface-node seq of the compactable span.
 * @param end - inclusive last surface-node seq of the compactable span.
 * @param chunkTokens - target token budget per index stub chunk.
 * @returns ordered stub regions and the trailing state region.
 */
export function planPassRegions(
  session: Session,
  measurement: TokenMeasurement,
  start: number,
  end: number,
  chunkTokens: number,
): PassPlan {
  const surfaceNodes = session.surface.nodes
  const startIdx = surfaceNodes.indexOf(start)
  const endIdx = surfaceNodes.indexOf(end)
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    throw new Error('planPassRegions: compactable span is not present on the surface')
  }

  const boundaries: number[] = []
  let chunkStart = startIdx
  let accumulated = 0
  for (let index = startIdx; index <= endIdx; index += 1) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    accumulated += measurement.nodes[index]!.tokens
    const atEnd = index === endIdx
    const overBudget = accumulated >= chunkTokens && index > chunkStart
    if (!overBudget && !atEnd) continue

    let cutIdx = index
    if (overBudget && !atEnd) {
      cutIdx = snapChunkEnd(session, surfaceNodes, chunkStart, index)
      if (cutIdx < chunkStart) cutIdx = chunkStart
    }
    boundaries.push(cutIdx)
    chunkStart = cutIdx + 1
    accumulated = 0
    index = cutIdx
  }

  if (boundaries.length === 0) {
    boundaries.push(endIdx)
  }

  // Ensure the trailing state slice is the final boundary segment.
  const regions: PlannedRegion[] = []
  let regionStart = startIdx
  for (const [i, boundary] of boundaries.entries()) {
    const isLast = i === boundaries.length - 1
    regions.push(makeRegion(
      surfaceNodes,
      regionStart,
      boundary,
      isLast ? 'state' : 'index',
    ))
    regionStart = boundary + 1
  }

  // A single-region span is always the state rewrite (first pass or resume tail).
  if (regions.length === 1) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const only = regions[0]!
    const state = { ...only, role: 'state' as const }
    return { stubs: [], state, all: [state] }
  }

  const stubs = regions.slice(0, -1)
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const state = regions.at(-1)!
  return { stubs, state, all: [...stubs, state] }
}

/** Build one planned region from inclusive surface indices. */
function makeRegion(
  surfaceNodes: readonly number[],
  startIdx: number,
  endIdx: number,
  role: 'index' | 'state',
): PlannedRegion {
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const start = surfaceNodes[startIdx]!
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const end = surfaceNodes[endIdx]!
  return {
    start,
    end,
    startIdx,
    endIdx,
    shadowedSeqs: surfaceNodes.slice(startIdx, endIdx + 1),
    role,
  }
}

/**
 * Snap a tentative chunk end leftward to a balanced boundary, preferring a
 * turn/end edge when one lies inside the provisional chunk.
 */
function snapChunkEnd(
  session: Session,
  surfaceNodes: readonly number[],
  chunkStart: number,
  tentativeEnd: number,
): number {
  let cut = tentativeEnd
  while (cut > chunkStart) {
    const cutSeq = surfaceNodes[cut]
    if (cutSeq === undefined || toolPairingBalancedAfter(session, cutSeq)) break
    cut -= 1
  }
  // Prefer the rightmost turn/end inside (chunkStart, cut] when available.
  for (let index = cut; index > chunkStart; index -= 1) {
    const nodeSeq = surfaceNodes[index]
    if (nodeSeq === undefined) continue
    const event = session.events[nodeSeq]
    if (event === undefined) continue
    if (event.type === 'turn/end' && toolPairingBalancedAfter(session, nodeSeq)) {
      return index
    }
    // Surface nodes are messages, not turn/end — look at adjacent log for step/end.
    if (event.type === 'assistant/message' || event.type === 'user/message') {
      // Prefer cutting after a completed step's last surface message.
      continue
    }
  }
  return cut
}
