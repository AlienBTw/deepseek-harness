/**
 * Bounded inverted-index search over shadowed conversation transcripts.
 * Optionally accelerates candidate selection through `ctx.sessionQuery` FTS.
 * @module @maple/tool-recall/search
 */

import type { Context } from '@maple/cordis'
import type { Session, SessionEvent } from '@maple/session'
import { renderEventToTranscript } from '@maple/session'
import type { SessionId } from '@maple/session'

/** One literal match returned to the model. */
export interface HistorySearchHit {
  readonly checkpointId: number
  readonly seq: number
  readonly snippet: string
}

/** Coverage metadata for a history_search response. */
export interface HistorySearchCoverage {
  readonly scanned: number
  readonly matched: number
  readonly truncated: boolean
  readonly mode: 'bounded-index' | 'session-query-fts'
}

/** Result of one shadowed-history search. */
export interface HistorySearchResult {
  readonly hits: readonly HistorySearchHit[]
  readonly coverage: HistorySearchCoverage
}

/** Maximum distinct tokens retained in the per-call inverted index. */
const MAX_INDEX_TOKENS = 4_096

/** Minimum token length indexed for literal acceleration. */
const MIN_TOKEN_LENGTH = 3

/** Maximum events examined when falling back to a linear scan of candidates. */
const MAX_SCAN_EVENTS = 8_192

/**
 * Search shadowed history with a bounded inverted index; when `sessionQuery` is
 * mounted, use FTS candidate seqs then verify with the same literal matcher.
 * @param ctx - Cordis context that may expose `sessionQuery`.
 * @param session - live agent session whose log is searched.
 * @param query - case-insensitive literal query.
 * @param targetSummaries - compaction/summary events whose spans are in scope.
 * @param limit - maximum hits to return.
 * @returns ordered hits plus coverage metadata.
 */
export async function searchShadowedHistory(
  ctx: Context,
  session: Session,
  query: string,
  targetSummaries: ReadonlyArray<SessionEvent & { type: 'compaction/summary' }>,
  limit: number,
): Promise<HistorySearchResult> {
  const shadowedSeqs = new Set<number>()
  const seqToCheckpoint = new Map<number, number>()
  for (const summary of targetSummaries) {
    for (const seq of summary.data.shadowedSeqs) {
      shadowedSeqs.add(seq)
      seqToCheckpoint.set(seq, summary.seq)
    }
  }

  const lowerQuery = query.toLowerCase()
  const ftsHits = await trySessionQueryFts(ctx, session.id, query, shadowedSeqs, limit * 4)
  if (ftsHits !== undefined) {
    const hits: HistorySearchHit[] = []
    let scanned = 0
    for (const seq of ftsHits) {
      scanned += 1
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const event = session.events[seq]!
      const transcript = renderEventToTranscript(event)
      if (transcript === null || !transcript.toLowerCase().includes(lowerQuery)) continue
      hits.push({
        checkpointId: seqToCheckpoint.get(seq) ?? 0,
        seq,
        snippet: transcript.length > 300 ? `${transcript.slice(0, 300)}...` : transcript,
      })
      if (hits.length >= limit) {
        return {
          hits,
          coverage: {
            scanned,
            matched: hits.length,
            truncated: true,
            mode: 'session-query-fts',
          },
        }
      }
    }
    return {
      hits,
      coverage: {
        scanned,
        matched: hits.length,
        truncated: false,
        mode: 'session-query-fts',
      },
    }
  }

  return searchWithBoundedIndex(session, lowerQuery, shadowedSeqs, seqToCheckpoint, limit)
}

/** Build a bounded token→seqs index over shadowed transcripts, then probe it. */
function searchWithBoundedIndex(
  session: Session,
  lowerQuery: string,
  shadowedSeqs: ReadonlySet<number>,
  seqToCheckpoint: ReadonlyMap<number, number>,
  limit: number,
): HistorySearchResult {
  const index = new Map<string, number[]>()
  const transcripts = new Map<number, string>()
  let indexedTokens = 0
  let scanned = 0

  for (const event of session.events) {
    if (!shadowedSeqs.has(event.seq)) continue
    if (scanned >= MAX_SCAN_EVENTS) break
    scanned += 1
    const transcript = renderEventToTranscript(event)
    if (transcript === null) continue
    transcripts.set(event.seq, transcript)
    if (indexedTokens >= MAX_INDEX_TOKENS) continue
    for (const token of tokenize(transcript.toLowerCase())) {
      if (indexedTokens >= MAX_INDEX_TOKENS) break
      let posting = index.get(token)
      if (posting === undefined) {
        posting = []
        index.set(token, posting)
        indexedTokens += 1
      }
      if (posting.length === 0 || posting.at(-1) !== event.seq) posting.push(event.seq)
    }
  }

  const queryTokens = tokenize(lowerQuery)
  let candidates: number[] | undefined
  if (queryTokens.length > 0) {
    for (const token of queryTokens) {
      const posting = index.get(token)
      if (posting === undefined) {
        candidates = []
        break
      }
      candidates = candidates === undefined ? [...posting] : intersectSorted(candidates, posting)
      if (candidates.length === 0) break
    }
  }

  const hitSeqs = candidates ?? [...transcripts.keys()]
  const hits: HistorySearchHit[] = []
  for (const seq of hitSeqs) {
    const transcript = transcripts.get(seq)
    if (transcript === undefined || !transcript.toLowerCase().includes(lowerQuery)) continue
    hits.push({
      checkpointId: seqToCheckpoint.get(seq) ?? 0,
      seq,
      snippet: transcript.length > 300 ? `${transcript.slice(0, 300)}...` : transcript,
    })
    if (hits.length >= limit) {
      return {
        hits,
        coverage: { scanned, matched: hits.length, truncated: true, mode: 'bounded-index' },
      }
    }
  }
  return {
    hits,
    coverage: { scanned, matched: hits.length, truncated: false, mode: 'bounded-index' },
  }
}

/** Optional FTS acceleration when `@maple/session-query` is mounted. */
async function trySessionQueryFts(
  ctx: Context,
  sessionId: SessionId,
  query: string,
  shadowedSeqs: ReadonlySet<number>,
  limit: number,
): Promise<number[] | undefined> {
  const sessionQuery = ctx.get('sessionQuery') as
    | { searchEvents?(request: {
      sessionId: SessionId
      query: string
      limit?: number
    }): Promise<{ items: Array<{ seq: number }> }> }
    | undefined
  if (sessionQuery?.searchEvents === undefined) return undefined
  try {
    const page = await sessionQuery.searchEvents({ sessionId, query, limit })
    const seqs: number[] = []
    for (const item of page.items) {
      if (shadowedSeqs.has(item.seq)) seqs.push(item.seq)
    }
    return seqs
  } catch {
    // Provider absence or query rejection falls back to the bounded in-log index.
    return undefined
  }
}

/** Split text into lowercase alphanumeric tokens of minimum length. */
function tokenize(text: string): string[] {
  return text
    .split(/[^a-z0-9_./:-]+/i)
    .map(token => token.toLowerCase())
    .filter(token => token.length >= MIN_TOKEN_LENGTH)
}

/** Intersect two ascending seq arrays. */
function intersectSorted(left: readonly number[], right: readonly number[]): number[] {
  const result: number[] = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const a = left[i]!
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const b = right[j]!
    if (a === b) {
      result.push(a)
      i += 1
      j += 1
    } else if (a < b) {
      i += 1
    } else {
      j += 1
    }
  }
  return result
}
