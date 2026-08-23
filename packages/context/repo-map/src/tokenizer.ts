/**
 * repomap/tokenizer.ts — Token counting for the repo-map.
 *
 * Ported from Aider's `RepoMap.token_count` (repomap.py lines 89–101).
 *
 * Aider uses the model's real tokenizer (tiktoken, cl100k_base / o200k_base). For a
 * dependency-light, portable module we use a chars/4 heuristic — accurate to within
 * ~15% for typical English/code text — BUT we keep Aider's critical sampling
 * optimization: for long text, sample every (num_lines // 100)-th line, tokenize the
 * sample, then extrapolate by char ratio. This keeps the binary-search loop fast.
 *
 * Swap `estimateTokensExact` for a real BPE tokenizer (js-tiktoken) if you need
 * byte-exact counts; the sampling wrapper stays the same.
 */

/**
 * Rough token estimate for a short string (no sampling). ~chars/4.
 * @param text - the text to size.
 * @returns the conservative ceiling-style estimate.
 */
export function estimateTokensExact(text: string): number {
  if (text.length === 0) return 0
  // Chars/4 is the standard GPT-family approximation for English/code.
  // Whitespace-heavy code averages slightly below 4, so this is conservative.
  return Math.ceil(text.length / 4)
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
