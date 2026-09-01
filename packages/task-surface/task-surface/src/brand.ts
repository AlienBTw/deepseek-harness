/**
 * Branded identifier constructors for Task Surface domain entities.
 * @module @maple/task-surface/brand
 */

import type { Branded } from '@maple/brand'

/** Opaque brand tag for unique Task Surface instances. */
export type TaskSurfaceId = Branded<'TaskSurfaceId'>

/**
 * Brand a string as a {@link TaskSurfaceId}.
 * @param id - raw identifier string.
 * @returns branded TaskSurfaceId.
 */
export function TaskSurfaceId(id: string): TaskSurfaceId {
  return id as TaskSurfaceId
}

/** Opaque brand tag for Task Surface submission identifiers. */
export type TaskSurfaceSubmissionId = Branded<'TaskSurfaceSubmissionId'>

/**
 * Brand a string as a {@link TaskSurfaceSubmissionId}.
 * @param id - raw identifier string.
 * @returns branded TaskSurfaceSubmissionId.
 */
export function TaskSurfaceSubmissionId(id: string): TaskSurfaceSubmissionId {
  return id as TaskSurfaceSubmissionId
}

/** Opaque brand tag for Task Surface dismissal identifiers. */
export type TaskSurfaceDismissalId = Branded<'TaskSurfaceDismissalId'>

/**
 * Brand a string as a {@link TaskSurfaceDismissalId}.
 * @param id - raw identifier string.
 * @returns branded TaskSurfaceDismissalId.
 */
export function TaskSurfaceDismissalId(id: string): TaskSurfaceDismissalId {
  return id as TaskSurfaceDismissalId
}
