/**
 * Shared cl100k_base token counting for pressure metering and repo-map budgets.
 * @module @maple/token-count
 */

import { getEncoding } from 'js-tiktoken'

/** Shared cl100k_base encoder. */
const encoder = getEncoding('cl100k_base')

/**
 * Exact token count for a string (no sampling).
 * @param text - the text to size.
 * @returns the cl100k_base token count.
 */
export function estimateTokensExact(text: string): number {
  if (text.length === 0) return 0
  return encoder.encode(text).length
}

/**
 * Token count with Aider's sampling optimization for long maps.
 *
 * For text shorter than 200 characters: full estimate.
 * For longer text: take every (num_lines // 100)-th line, estimate the sample,
 * then scale by the char-length ratio (sample -> whole).
 *
 * @param text - the rendered map text to size for the budget search.
 * @returns the extrapolated token count.
 */
export function tokenCount(text: string): number {
  const lenText = text.length
  if (lenText < 200) {
    return estimateTokensExact(text)
  }

  const lines = text.split(/\r?\n/)
  const numLines = lines.length
  if (numLines === 0) return 0

  const step = Math.floor(numLines / 100) || 1
  const sample: string[] = []
  for (let i = 0; i < numLines; i += step) {
    const l = lines[i]; if (l !== undefined) sample.push(l)
  }
  const sampleText = sample.join('\n')
  const sampleTokens = estimateTokensExact(sampleText)

  if (sampleText.length === 0) return 0
  const estTokens = (sampleTokens / sampleText.length) * lenText
  return Math.ceil(estTokens)
}
