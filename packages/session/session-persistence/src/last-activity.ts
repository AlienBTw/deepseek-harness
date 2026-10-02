/**
 * Shared human-prompt activity predicate and reducer for Session list
 * recency. Attached projections and durable index writers must agree on
 * which events bump `lastPromptAt`.
 * @module @maple/session-persistence/last-activity
 */

import type { SessionEvent } from '@maple/session'

/**
 * Whether an event is a human-authored prompt for Session-list recency.
 * Injected user messages, synthetic closers, and pickup boundaries do not
 * qualify — only `user/message` with `source.kind === 'user'`.
 * @param event - one session event.
 * @returns true when the event's time should become `lastPromptAt`.
 */
export function isHumanPromptEvent(event: SessionEvent): boolean {
  return event.type === 'user/message' && event.data.source?.kind === 'user'
}

/**
 * Advance the latest human-prompt time by one event.
 * @param previous - accumulated prompt time, or `null` when none yet.
 * @param event - the next event in log or append-batch order.
 * @returns the event's time when it is a human prompt, otherwise `previous`.
 */
export function reduceLastPromptAt(previous: number | null, event: SessionEvent): number | null {
  return isHumanPromptEvent(event) ? event.time : previous
}

/**
 * Fold the latest human-prompt time over a contiguous event batch or log.
 * @param previous - prompt time already known before this batch, if any.
 * @param events - events in ascending seq order.
 * @returns the latest human-prompt time, or `undefined` when none exists.
 */
export function foldLastPromptAt(
  previous: number | undefined,
  events: readonly SessionEvent[],
): number | undefined {
  let last: number | null = previous ?? null
  for (const event of events) last = reduceLastPromptAt(last, event)
  return last === null ? undefined : last
}
