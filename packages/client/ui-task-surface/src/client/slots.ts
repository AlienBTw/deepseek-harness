/**
 * TaskSurfaceDock injected face. The live correlation arrives through
 * `useProjection('taskSurface')`; inject carries only the Remote-backed
 * inspection, submit, and dismiss verbs.
 */

import type {
  DismissTaskSurfaceRequest,
  DismissTaskSurfaceResult,
  GetActiveTaskSurfaceResult,
  SubmitTaskSurfaceRequest,
  SubmitTaskSurfaceResult,
} from '@maple/task-surface/client'

/** Wire body for submit (session id resolved from the dock session scope). */
export type SubmitTaskSurfaceRemoteRequest = Omit<SubmitTaskSurfaceRequest, 'sessionId'>

/** Wire body for dismiss (session id resolved from the dock session scope). */
export type DismissTaskSurfaceRemoteRequest = Omit<DismissTaskSurfaceRequest, 'sessionId'>

/** Injected business face of the TaskSurface dock entry. */
export interface TaskSurfaceDockActions {
  /** Load the authoritative active surface model for the current session. */
  onGetActive: () => Promise<GetActiveTaskSurfaceResult>
  /**
   * Submit field values for the active surface.
   * @param request - surface identity, submission id, and captured values.
   */
  onSubmit: (request: SubmitTaskSurfaceRemoteRequest) => Promise<SubmitTaskSurfaceResult>
  /**
   * Dismiss the active surface without submitting a prompt.
   * @param request - surface identity and dismissal id.
   */
  onDismiss: (request: DismissTaskSurfaceRemoteRequest) => Promise<DismissTaskSurfaceResult>
}
