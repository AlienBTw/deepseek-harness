/**
 * Deterministic recall checkpoint footers for model-visible compaction output.
 * @module @maple/compaction-recallable/footer
 */

/** Inclusive shadowed surface span recorded on `compaction/summary`. */
export interface ShadowedRange {
  readonly start: number
  readonly end: number
}

/**
 * Compose the deterministic recall footer appended to every checkpoint.
 * @param summarySeq - seq of the `compaction/summary` event for this checkpoint.
 * @param shadowedRange - inclusive surface span replaced by the checkpoint.
 * @returns footer text the model can use with `history_read`.
 */
export function composeRecallFooter(summarySeq: number, shadowedRange: ShadowedRange): string {
  return `[checkpoint c${summarySeq}: shadows conversation span #${shadowedRange.start}–#${shadowedRange.end}; originals retrievable via history_read]`
}
