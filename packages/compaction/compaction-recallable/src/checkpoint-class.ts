/**
 * Classify compaction checkpoints on the surface and in the append-only log.
 * @module @maple/compaction-recallable/checkpoint-class
 */

import { isCompactCheckpointSource } from '@maple/compaction'
import type { CompactionCheckpointSource, CompactionId } from '@maple/compaction'
import type { Session, SessionEvent } from '@maple/session'
import type { Message } from '@maple/llm'
import type { CheckpointKind } from './types.ts'

/** One surface node that is a compaction checkpoint replacement. */
export interface SurfaceCheckpoint {
  /** Surface index of the replacement user message. */
  readonly surfaceIdx: number
  /** Seq of the replacement user message. */
  readonly seq: number
  /** Owning compaction identity. */
  readonly compactionId: CompactionId
  /** Seq of the companion `compaction/summary` event. */
  readonly summarySeq: number
  /** Resolved checkpoint class (`state` when `kind` was omitted). */
  readonly kind: CheckpointKind
}

/**
 * Resolve checkpoint class from a `compaction/summary` event.
 * Legacy summaries without `kind` are treated as state-class.
 * @param event - summary event to classify.
 * @returns checkpoint class.
 */
export function summaryCheckpointKind(
  event: SessionEvent & { type: 'compaction/summary' },
): CheckpointKind {
  return event.data.kind === 'index' ? 'index' : 'state'
}

/**
 * List current-surface compaction checkpoints in surface order.
 * @param session - session whose surface and log are inspected.
 * @returns surface checkpoints with resolved kinds.
 */
export function listSurfaceCheckpoints(session: Session): SurfaceCheckpoint[] {
  const byCompactionId = new Map<string, SessionEvent & { type: 'compaction/summary' }>()
  for (const event of session.events) {
    if (event.type !== 'compaction/summary') continue
    byCompactionId.set(event.data.compactionId, event as SessionEvent & { type: 'compaction/summary' })
  }

  const result: SurfaceCheckpoint[] = []
  for (const [surfaceIdx, seq] of session.surface.nodes.entries()) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const event = session.events[seq]!
    if (event.type !== 'user/message') continue
    const message = ('message' in event.data ? event.data.message : event.data) as Message
    if (!isCompactCheckpointSource(message.source)) continue
    const source = message.source as CompactionCheckpointSource
    const summary = byCompactionId.get(source.compactionId)
    if (summary === undefined) continue
    result.push({
      surfaceIdx,
      seq,
      compactionId: source.compactionId,
      summarySeq: summary.seq,
      kind: summaryCheckpointKind(summary),
    })
  }
  return result
}

/**
 * Index of the last frozen index stub on the surface, or `-1` when none exist.
 * @param session - session supplying surface checkpoints.
 * @returns surface index of the last index stub.
 */
export function lastIndexStubSurfaceIdx(session: Session): number {
  const checkpoints = listSurfaceCheckpoints(session)
  let last = -1
  for (const checkpoint of checkpoints) {
    if (checkpoint.kind === 'index') last = checkpoint.surfaceIdx
  }
  return last
}

/**
 * Whether a prior pass committed one or more index stubs without landing the
 * matching state rewrite — resume must finish remaining regions unconditionally.
 * @param session - session inspected after a possible mid-commit crash.
 * @returns whether remaining regions should commit without the inflation guard.
 */
export function isIncompleteRecallablePass(session: Session): boolean {
  const checkpoints = listSurfaceCheckpoints(session)
  if (checkpoints.length === 0) return false
  let sawIndexAfterState = false
  let lastKind: CheckpointKind | undefined
  for (const checkpoint of checkpoints) {
    if (checkpoint.kind === 'state') {
      sawIndexAfterState = false
      lastKind = 'state'
      continue
    }
    if (lastKind === 'state' || lastKind === undefined || lastKind === 'index') {
      sawIndexAfterState = true
      lastKind = 'index'
    }
  }
  if (!sawIndexAfterState || lastKind !== 'index') return false
  const last = checkpoints.at(-1)
  if (last === undefined || last.kind !== 'index') return false
  // Incomplete when raw (non-checkpoint) surface nodes remain after the last stub.
  return last.surfaceIdx < session.surface.nodes.length - 1
    && !checkpoints.some(checkpoint => (
      checkpoint.kind === 'state' && checkpoint.surfaceIdx === last.surfaceIdx + 1
    ))
}

/**
 * Latest state-class `compaction/summary` in the log (including superseded ones).
 * @param session - session whose append-only log is scanned.
 * @returns the newest state-class summary, if any.
 */
export function latestStateSummary(
  session: Session,
): (SessionEvent & { type: 'compaction/summary' }) | undefined {
  let latest: (SessionEvent & { type: 'compaction/summary' }) | undefined
  for (const event of session.events) {
    if (event.type !== 'compaction/summary') continue
    const summary = event as SessionEvent & { type: 'compaction/summary' }
    if (summaryCheckpointKind(summary) !== 'state') continue
    latest = summary
  }
  return latest
}
