/**
 * repomap/tokenizer.ts — Token counting for the repo-map.
 *
 * Ported from Aider's `RepoMap.token_count` (repomap.py lines 89–101).
 *
 * Uses cl100k_base through js-tiktoken. For long text we keep Aider's
 * sampling optimization: sample every (num_lines // 100)-th line, tokenize the
 * sample, then extrapolate by char ratio so the binary-search loop stays fast.
 */

import { getEncoding } from 'js-tiktoken'

/** Shared cl100k_base encoder for repo-map budgeting. */
const encoder = getEncoding('cl100k_base')

/**
 * Exact token count for a short string (no sampling).
 * @param text - the text to size.
 * @returns the cl100k_base token count.
 */
export function estimateTokensExact(text: string): number {
  if (text.length === 0) return 0
  return encoder.encode(text).length
}

/**
 * Token count with Aider's sampling optimization.
 *
 * For text < 200 chars: full estimate.
 * For longer text: take every (num_lines // 100)-th line, estimate the sample,
 * then scale by the char-length ratio (sample -> whole).
 *
 * Mirrors repomap.py lines 89–101 exactly in structure.
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
  // Reconstruct keeping line breaks (Aider uses keepends; we approximate by re-joining).
  const sampleText = sample.join('\n')
  const sampleTokens = estimateTokensExact(sampleText)

  // Scale by char ratio (guard against divide-by-zero).
  if (sampleText.length === 0) return 0
  const estTokens = (sampleTokens / sampleText.length) * lenText
  return Math.ceil(estTokens)
}
