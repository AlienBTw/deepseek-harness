/**
 * Process-local Task Surface submission coordination via agent inbox events.
 * @module @maple/task-surface/coordination
 */

import type { Context } from '@maple/cordis'
import type { MessageId, MessageSource } from '@maple/llm'
import type { Session, SessionEvent } from '@maple/session'
import type { TaskSurfacePendingSubmission } from './types.ts'

/** Pending submission table keyed by surfaceId. */
export type PendingSubmissionMap = Map<string, TaskSurfacePendingSubmission>

function isTaskSurfaceUserSource(source: MessageSource): source is MessageSource & {
  taskSurface: { surfaceId: string; submissionId: string }
} {
  return source.kind === 'user'
    && typeof (source as { taskSurface?: unknown }).taskSurface === 'object'
    && (source as { taskSurface: { surfaceId?: unknown } }).taskSurface?.surfaceId !== undefined
}

/**
 * Install inbox and session listeners that advance Task Surface pending phases.
 * @param ctx - Cordis context.
 * @param pendingSubmissions - shared pending map owned by TaskSurfaceService.
 * @returns disposer for registered listeners.
 */
export function installTaskSurfaceCoordination(
  ctx: Context,
  pendingSubmissions: PendingSubmissionMap,
): () => void {
  const disposers: Array<() => void> = []

  disposers.push(ctx.on('agent/inbox/claimed', ({ message }) => {
    for (const pending of pendingSubmissions.values()) {
      if (pending.messageId === message.id && pending.phase === 'queued') {
        pending.phase = 'claiming'
      }
    }
  }))

  disposers.push(ctx.on('agent/inbox/discarded', ({ message }) => {
    for (const [surfaceId, pending] of pendingSubmissions.entries()) {
      if (pending.messageId === message.id) {
        pendingSubmissions.delete(surfaceId)
      }
    }
  }))

  disposers.push(ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [Session, SessionEvent]
    if (event.type !== 'user/message') return
    const source = event.data.source
    if (!isTaskSurfaceUserSource(source)) return
    const pending = pendingSubmissions.get(source.taskSurface.surfaceId)
    if (pending !== undefined && pending.submissionId === source.taskSurface.submissionId) {
      pendingSubmissions.delete(source.taskSurface.surfaceId)
    }
  }))

  return () => {
    for (const dispose of disposers) dispose()
  }
}

/**
 * Resolve pending submission by message id.
 * @param pendingSubmissions - active pending map.
 * @param messageId - durable user message id.
 * @returns pending record when found.
 */
export function pendingForMessage(
  pendingSubmissions: PendingSubmissionMap,
  messageId: MessageId,
): TaskSurfacePendingSubmission | undefined {
  for (const pending of pendingSubmissions.values()) {
    if (pending.messageId === messageId) return pending
  }
  return undefined
}
