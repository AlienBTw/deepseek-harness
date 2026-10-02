/**
 * Advisor framing and merge-back message builders for interactive side sessions.
 * @module @maple/sidechat/framing
 */

import { boundContextSummary, createUserMessage } from '@maple/llm'
import type { UserMessage } from '@maple/llm'

/** Durable plugin label stamped on advisor framing and merge-back messages. */
export const SIDECHAT_PLUGIN = 'sidechat'

/** Default Unicode code-point cap for one merge-back note. */
export const DEFAULT_MERGE_MAX_CHARS = 2000

/**
 * Model-facing advisor framing kept byte-stable so the child inherits the
 * parent's system prompt (and provider prefix cache) unchanged.
 */
export const ADVISOR_FRAMING_TEXT
  = 'You are a read-only advisor in a side session forked from a parent conversation. '
    + 'Explain and analyze using only read-only tools. Do not mutate files, run '
    + 'state-changing shell commands, continue the parent task, or attempt write '
    + 'operations. When asked for a handback, produce a concise conclusion the parent '
    + 'can reuse.'

/** Denial reason when a side-session agent attempts a mutating tool. */
export const SIDECHAT_READONLY_DENY_REASON
  = 'side session is read-only: only tools classified concurrency-safe (read-only) may run'

/**
 * Cap a merge-back note to a maximum character length.
 * @param note - raw handback text.
 * @param maxChars - inclusive maximum length after capping.
 * @returns the note, ellipsized when longer than `maxChars`.
 */
export function capMergeNote(note: string, maxChars: number): string {
  const trimmed = note.trim()
  if (trimmed.length <= maxChars) return trimmed
  if (maxChars <= 1) return '…'
  return `${trimmed.slice(0, maxChars - 1)}…`
}

/**
 * Build the durable advisor framing message for a freshly forked side session.
 * @returns a plugin-sourced user message for `session.append`.
 */
export function advisorFramingMessage(): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: ADVISOR_FRAMING_TEXT }],
    source: {
      kind: 'plugin',
      plugin: SIDECHAT_PLUGIN,
      form: 'notice',
      summary: boundContextSummary('Side-session advisor'),
    },
  })
}

/**
 * Build the durable merge-back message for a parent session.
 * @param note - already length-capped handback text.
 * @returns a plugin-sourced user message for `session.append`.
 */
export function mergeBackMessage(note: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: `Side-session handback:\n\n${note}` }],
    source: {
      kind: 'plugin',
      plugin: SIDECHAT_PLUGIN,
      form: 'notice',
      summary: boundContextSummary('Side-session handback'),
    },
  })
}
