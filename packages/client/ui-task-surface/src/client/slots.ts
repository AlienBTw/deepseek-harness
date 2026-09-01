/**
 * TaskSurfaceDock injected face. The live correlation arrives through
 * `useProjection('taskSurface')`; inject carries only the Remote-backed
 * inspection and submit verbs.
 */

import type {
  GetActiveTaskSurfaceResult,
  SubmitTaskSurfaceRequest,
  SubmitTaskSurfaceResult,
} from '@maple/task-surface/client'

/** Wire body for submit (session id resolved from the dock session scope). */
export type SubmitTaskSurfaceRemoteRequest = Omit<SubmitTaskSurfaceRequest, 'sessionId'>

/** Injected business face of the TaskSurface dock entry. */
export interface TaskSurfaceDockActions {
  /** Load the authoritative active surface model for the current session. */
  onGetActive: () => Promise<GetActiveTaskSurfaceResult>
  /**
   * Submit field values for the active surface.
   * @param request - surface identity, submission id, and captured values.
   */
  onSubmit: (request: SubmitTaskSurfaceRemoteRequest) => Promise<SubmitTaskSurfaceResult>
}
