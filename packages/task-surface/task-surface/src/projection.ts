/**
 * Session projection for active Task Surface state.
 * @module @maple/task-surface/projection
 */

import type { SessionEvent } from '@maple/session'
import type { TaskSurfacePresentationMeta, TaskSurfaceProjection } from './types.ts'

/** Initial empty state for the active Task Surface session projection. */
export const initialTaskSurfaceProjection: TaskSurfaceProjection = {
  active: null,
}

/**
 * Fold a session event into the Task Surface active projection.
 * @param state - previous projection state.
 * @param event - durable session event.
 * @returns updated projection state.
 */
export function foldTaskSurfaceEvent(
  state: TaskSurfaceProjection,
  event: SessionEvent,
): TaskSurfaceProjection {
  if (event.type === 'tool/result') {
    const meta = event.data.meta as TaskSurfacePresentationMeta | undefined
    if (meta) {
      const callId = event.data.message.source.callId
      return {
        active: {
          callId,
          surfaceId: meta.surfaceId,
        },
      }
    }
  }

  if (event.type === 'task-surface/dismissed') {
    if (state.active && state.active.surfaceId === event.data.surfaceId) {
      return { active: null }
    }
  }

  if (event.type === 'user/message') {
    // Any user message closes an active surface (either via submission or explicit bypass)
    if (state.active !== null) {
      return { active: null }
    }
  }

  return state
}
