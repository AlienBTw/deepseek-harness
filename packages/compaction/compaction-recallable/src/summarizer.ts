/**
 * Recallable checkpoint framing atop the basic compaction summarizer.
 * @module @maple/compaction-recallable/summarizer
 */

import { frameSummary } from '@maple/compaction-basic/src/summarizer.ts'
import type { ContentBlock } from '@maple/llm'
import { composeRecallFooter, type ShadowedRange } from './footer.ts'

/**
 * Wrap summary blocks with the basic checkpoint framing and a deterministic recall footer.
 * @param summary - safe text-only model output.
 * @param summarySeq - seq of the companion `compaction/summary` event.
 * @param shadowedRange - inclusive surface span replaced by the checkpoint.
 * @returns content for the synthesized replacement user message.
 */
export function frameRecallableSummary(
  summary: readonly ContentBlock[],
  summarySeq: number,
  shadowedRange: ShadowedRange,
): ContentBlock[] {
  const footer = composeRecallFooter(summarySeq, shadowedRange)
  return [
    ...frameSummary(summary),
    { type: 'text', text: `\n\n${footer}` },
  ]
}
