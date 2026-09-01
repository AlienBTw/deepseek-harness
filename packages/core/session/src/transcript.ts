/**
 * Shared transcript rendering from append-only session events.
 * @module @maple/session/transcript
 */

import type { SessionEvent } from './types.ts'
import type { ContentBlock, Message, ToolResultMessage } from '@maple/llm'

/**
 * Render content blocks to plain text.
 * @param blocks - content blocks from message or tool result.
 * @returns plain text rendering.
 */
export function renderBlocks(blocks: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        parts.push(block.text)
        break
      case 'reasoning':
        // Omit internal reasoning from plain transcript
        break
      case 'tool-call':
        parts.push(`[Called ${block.name}(${block.arguments}) with id ${block.id}]`)
        break
      case 'tool-result':
        parts.push(`[Tool result ${block.toolCallId}: ${renderBlocks(block.content)}]`)
        break
      case 'image':
        parts.push(`[Image attachment ${block.attachment.attachmentId}]`)
        break
    }
  }
  return parts.join('\n')
}

/**
 * Render an individual session event into transcript format.
 * @param event - the durable session event.
 * @returns line-based transcript entry, or null if non-surface/internal.
 */
export function renderEventToTranscript(event: SessionEvent): string | null {
  switch (event.type) {
    case 'user/message': {
      const msg = (('message' in event.data ? event.data.message : event.data) as Message | undefined)
      if (!msg?.content) return null
      const text = renderBlocks(msg.content)
      return `User:\n${text}`
    }
    case 'assistant/message': {
      const msg = (('message' in event.data ? event.data.message : event.data) as Message | undefined)
      if (!msg?.content) return null
      const text = renderBlocks(msg.content)
      return `Assistant:\n${text}`
    }
    case 'tool/call': {
      const data = event.data as unknown as { name?: string; arguments?: string; callId?: string }
      return `Assistant called tool: ${data.name ?? 'unknown'}(${data.arguments ?? ''}) [id: ${data.callId ?? ''}]`
    }
    case 'tool/result': {
      const msg = event.data.message as ToolResultMessage | undefined
      const content = msg ? msg.content : ((event.data as unknown as { content?: ContentBlock[] }).content ?? [])
      const text = renderBlocks(content)
      const err = event.data.error ? ` (error: ${event.data.error.name}: ${event.data.error.code})` : ''
      const callId = msg ? msg.source.callId : ((event.data as unknown as { callId?: string }).callId ?? '')
      return `Tool result [id: ${callId}]${err}:\n${text}`
    }
    default:
      return null
  }
}
