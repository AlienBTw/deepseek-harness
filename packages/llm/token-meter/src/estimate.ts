/**
 * Tokenizer-true (cl100k_base) token pricing shared by the meter service and the
 * pure context-breakdown projection, so both surfaces price identical content
 * to identical numbers. Provider-reported usage remains preferred when a matching
 * envelope anchor exists on the session.
 *
 * @module @maple/token-meter/estimate
 */

import type { ContentBlock, Message } from '@maple/llm'
import type { EpochHeader } from '@maple/session'
import { estimateTokensExact } from '@maple/token-count'

/** Per-block structural overhead for JSON framing and type tags. */
const BLOCK_OVERHEAD = 4

/** Role-field framing overhead added to every priced message. */
export const ROLE_OVERHEAD = 4

/**
 * Price content blocks recursively under cl100k_base.
 * @param blocks - content blocks to price without mutation.
 * @returns tokens including per-block structural overhead.
 */
export function estimateContent(blocks: readonly ContentBlock[]): number {
  let tokens = 0
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += estimateTokensExact(block.text) + BLOCK_OVERHEAD
        break
      case 'tool-call':
        tokens += estimateTokensExact(block.name)
          + estimateTokensExact(block.arguments)
          + BLOCK_OVERHEAD
        break
      case 'tool-result':
        tokens += estimateContent(block.content) + BLOCK_OVERHEAD
        break
      default:
        // ContentBlockMap is merge-extensible; unknown blocks retain a
        // conservative structural JSON price under the shared tokenizer.
        tokens += BLOCK_OVERHEAD + estimateTokensExact(JSON.stringify(block))
    }
  }
  return tokens
}

/**
 * Price one model-visible message.
 * @param message - message to price without mutation.
 * @returns content and role-framing tokens.
 */
export function estimateMessage(message: Message): number {
  return estimateContent(message.content) + ROLE_OVERHEAD
}

/**
 * Price the system-prompt part of a canonical request envelope.
 * @param header - canonical envelope, or undefined before any request.
 * @returns system-prompt tokens; 0 when absent.
 */
export function estimateSystemTokens(header: EpochHeader | undefined): number {
  if (header?.system === undefined) return 0
  return estimateTokensExact(header.system) + ROLE_OVERHEAD
}

/**
 * Price the tool-schema part of a canonical request envelope.
 * @param header - canonical envelope, or undefined before any request.
 * @returns tool-schema tokens; 0 when absent or empty.
 */
export function estimateToolsTokens(header: EpochHeader | undefined): number {
  if (header?.tools === undefined || header.tools.length === 0) return 0
  return estimateTokensExact(JSON.stringify(header.tools)) + BLOCK_OVERHEAD
}

/**
 * Price the complete non-surface request envelope.
 * @param header - canonical envelope, or undefined before any request.
 * @returns system plus tool tokens.
 */
export function estimateHeader(header: EpochHeader | undefined): number {
  return estimateSystemTokens(header) + estimateToolsTokens(header)
}
