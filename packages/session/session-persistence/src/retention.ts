/**
 * Shared session-list pagination and retention victim selection for persistence
 * backends. Sorting and cursor encoding stay identical across JSONL and SQLite
 * so ApiProxy pages one vocabulary.
 * @module @maple/session-persistence/retention
 */

import type { SessionHeader, SessionId } from '@maple/session'

/** Optional retention ceilings applied by {@link selectGcVictims}. */
export interface SessionRetentionPolicy {
  /** Delete sessions whose activity is older than this many whole days. */
  readonly maxAgeDays?: number
  /** Keep at most this many newest sessions after age pruning. */
  readonly maxSessions?: number
}

/** One page of session headers plus an opaque continuation cursor. */
export interface SessionListPage {
  /** Newest-first headers for this page. */
  readonly items: SessionHeader[]
  /** Opaque cursor for the next page; absent when this page exhausted the store. */
  readonly nextCursor?: string
}

/** Query for {@link pageSessionHeaders}. */
export interface SessionListQuery {
  /** Opaque cursor from a previous page; omit for the newest page. */
  readonly cursor?: string
  /** Maximum headers to return; must be a positive safe integer. */
  readonly limit: number
}

/** Activity timestamp used for newest-first order and age GC. */
export function sessionActivityAt(header: SessionHeader): number {
  return header.lastPromptAt ?? header.createdAt
}

/** Newest-first by activity, then id descending for a stable total order. */
export function compareSessionHeadersNewestFirst(left: SessionHeader, right: SessionHeader): number {
  const activity = sessionActivityAt(right) - sessionActivityAt(left)
  if (activity !== 0) return activity
  return right.id < left.id ? -1 : right.id > left.id ? 1 : 0
}

/** Opaque cursor payload shared by header and summary pagers. */
interface KeysetCursor {
  readonly t: number
  readonly id: string
}

/** Encode the keyset cursor after the last returned row. */
function encodeCursor(activityAt: number, id: string): string {
  return Buffer.from(JSON.stringify({ t: activityAt, id }), 'utf8').toString('base64url')
}

/** Decode a keyset cursor; malformed input fails loud. */
function decodeCursor(cursor: string): KeysetCursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch (error: unknown) {
    throw new Error(`session list cursor is not valid base64url JSON: ${String(error)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('session list cursor must be a JSON object')
  }
  const record = parsed as Record<string, unknown>
  if (typeof record['t'] !== 'number' || !Number.isSafeInteger(record['t']) || record['t'] < 0
    || typeof record['id'] !== 'string' || record['id'].length === 0) {
    throw new Error('session list cursor must carry non-negative activity `t` and non-empty `id`')
  }
  return { t: record['t'], id: record['id'] }
}

/**
 * Whether `activityAt`/`id` sorts strictly after the cursor in newest-first order.
 * @param activityAt - candidate activity timestamp.
 * @param id - candidate session id.
 * @param cursor - decoded keyset from a previous page.
 */
function afterCursor(activityAt: number, id: string, cursor: KeysetCursor): boolean {
  if (activityAt < cursor.t) return true
  if (activityAt > cursor.t) return false
  return id < cursor.id
}

/** One row that can be keyset-paged newest-first. */
export interface SessionListKey {
  /** Opaque session identity used in the cursor. */
  readonly id: string
  /** Activity timestamp used for newest-first order. */
  readonly activityAt: number
}

/**
 * Page arbitrary newest-first rows with the same keyset cursor vocabulary as
 * {@link pageSessionHeaders}.
 * @param rows - candidate rows; order is ignored and re-sorted here.
 * @param query - limit plus optional cursor from a previous page.
 * @returns one page and an optional next cursor.
 */
export function pageSessionListKeys<T extends SessionListKey>(
  rows: readonly T[],
  query: SessionListQuery,
): { items: T[]; nextCursor?: string } {
  if (!Number.isSafeInteger(query.limit) || query.limit < 1) {
    throw new TypeError('session list limit must be a positive safe integer')
  }
  const sorted = [...rows].sort((left, right) => {
    const activity = right.activityAt - left.activityAt
    if (activity !== 0) return activity
    return right.id < left.id ? -1 : right.id > left.id ? 1 : 0
  })
  const cursor = query.cursor
  const start = cursor === undefined
    ? 0
    : sorted.findIndex(row => afterCursor(row.activityAt, row.id, decodeCursor(cursor)))
  if (cursor !== undefined && start < 0) {
    return { items: [] }
  }
  const items = sorted.slice(start, start + query.limit)
  const exhausted = start + query.limit >= sorted.length
  const last = items.at(-1)
  return exhausted || last === undefined
    ? { items }
    : { items, nextCursor: encodeCursor(last.activityAt, last.id) }
}

/**
 * Page a preloaded header list newest-first with keyset continuation.
 * @param headers - every stored header; order is ignored and re-sorted here.
 * @param query - limit plus optional cursor from a previous page.
 * @returns one page of headers and an optional next cursor.
 */
export function pageSessionHeaders(
  headers: readonly SessionHeader[],
  query: SessionListQuery,
): SessionListPage {
  const page = pageSessionListKeys(
    headers.map(header => ({ header, id: header.id, activityAt: sessionActivityAt(header) })),
    query,
  )
  return {
    items: page.items.map(row => row.header),
    ...page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor },
  }
}

/**
 * Choose sessions to delete under a retention policy.
 * Age pruning runs first (activity older than `maxAgeDays`), then count
 * pruning keeps the newest `maxSessions` survivors. Live-session exclusion is
 * the caller's responsibility.
 * @param headers - candidate stored sessions.
 * @param policy - optional age and count ceilings.
 * @param nowMs - evaluation clock in epoch milliseconds.
 * @returns ids to delete, oldest-first within each phase.
 */
export function selectGcVictims(
  headers: readonly SessionHeader[],
  policy: SessionRetentionPolicy,
  nowMs: number,
): SessionId[] {
  if (policy.maxAgeDays === undefined && policy.maxSessions === undefined) return []
  if (policy.maxAgeDays !== undefined
    && (!Number.isSafeInteger(policy.maxAgeDays) || policy.maxAgeDays < 1)) {
    throw new TypeError('retention maxAgeDays must be a positive safe integer')
  }
  if (policy.maxSessions !== undefined
    && (!Number.isSafeInteger(policy.maxSessions) || policy.maxSessions < 1)) {
    throw new TypeError('retention maxSessions must be a positive safe integer')
  }

  const victims: SessionId[] = []
  const victimSet = new Set<SessionId>()
  let remaining = [...headers]

  if (policy.maxAgeDays !== undefined) {
    const cutoff = nowMs - policy.maxAgeDays * 86_400_000
    const aged = remaining
      .filter(header => sessionActivityAt(header) < cutoff)
      .sort(compareSessionHeadersNewestFirst)
      .reverse()
    for (const header of aged) {
      victims.push(header.id)
      victimSet.add(header.id)
    }
    remaining = remaining.filter(header => !victimSet.has(header.id))
  }

  if (policy.maxSessions !== undefined && remaining.length > policy.maxSessions) {
    const newestFirst = [...remaining].sort(compareSessionHeadersNewestFirst)
    for (const header of newestFirst.slice(policy.maxSessions).reverse()) {
      if (victimSet.has(header.id)) continue
      victims.push(header.id)
      victimSet.add(header.id)
    }
  }

  return victims
}
