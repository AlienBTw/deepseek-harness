/**
 * Completed-turn seed selection for interactive side-session forks.
 * @module @maple/sidechat/seed
 */

import type { SessionEvent } from '@maple/session'

/**
 * Inclusive event count of the balanced completed-turn prefix to copy.
 *
 * Mirrors Host `session.fork` cut policy: an in-log `atSeq` selects the first
 * `turn/end` at or after that anchor and never clips backward; an omitted or
 * past-end anchor uses the last completed turn; trailing standalone events
 * after that boundary are included until the next `turn/start`.
 *
 * @param events - source session events in log order.
 * @param atSeq - optional inclusive seq anchor inside the desired turn.
 * @returns the number of leading events to seed, or `undefined` when no
 *   completed turn is available for the requested cut.
 */
export function completedTurnSeedLength(
  events: readonly SessionEvent[],
  atSeq?: number,
): number | undefined {
  const lastSeq = events.at(-1)?.seq ?? -1
  const anchoredBoundary = atSeq === undefined
    ? undefined
    : events.find(event => event.type === 'turn/end' && event.seq >= atSeq)
  const boundary = anchoredBoundary
    ?? (atSeq === undefined || atSeq > lastSeq
      ? events.findLast(event => event.type === 'turn/end')
      : undefined)
  if (boundary === undefined) return undefined
  let cut = boundary.seq + 1
  while (cut < events.length && events[cut]?.type !== 'turn/start') cut++
  return cut
}

/**
 * Flatten assistant text blocks from the newest durable assistant message.
 * @param events - session events in log order.
 * @returns joined assistant text, or `undefined` when none exists.
 */
export function latestAssistantText(events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    const text = event.data.message.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()
    if (text.length > 0) return text
  }
  return undefined
}
