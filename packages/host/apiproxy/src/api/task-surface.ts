/**
 * taskSurface domain contract. Method signatures are the source of truth:
 * unary methods take the RpcRequest<P> narrow form and the impl echoes rpcId.
 *
 * Active reads join the session log, presentation metadata, and the Host
 * service's process-local pending coordination record. Submit starts the next
 * turn through ordinary Agent admission; dismiss appends one log event and
 * starts no turn.
 */

import type { SessionId } from '@maple/session/types'
import type {
  DismissTaskSurfaceResult,
  GetActiveTaskSurfaceResult,
  SubmitTaskSurfaceResult,
  TaskSurfaceDismissalId,
  TaskSurfaceId,
  TaskSurfaceSubmissionId,
} from '@maple/task-surface/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

export type {
  TaskSurfaceDismissalId,
  TaskSurfaceId,
  TaskSurfaceSubmissionId,
} from '@maple/task-surface/types'

/** Task Surface unary methods on one ordinary session. */
export interface TaskSurfaceApi {
  /** Read the active surface for a session, optionally pinning one surface id. */
  getActive(request: RpcRequest<{ sessionId: SessionId; surfaceId?: TaskSurfaceId }>):
  Promise<RpcResponse<GetActiveTaskSurfaceResult>>

  /** Submit structured values for an active surface and queue the next turn. */
  submit(request: RpcRequest<{
    sessionId: SessionId
    surfaceId: TaskSurfaceId
    submissionId: TaskSurfaceSubmissionId
    values: Record<string, unknown>
    note?: string
  }>): Promise<RpcResponse<SubmitTaskSurfaceResult>>

  /** Dismiss an active surface without starting a turn. */
  dismiss(request: RpcRequest<{
    sessionId: SessionId
    surfaceId: TaskSurfaceId
    dismissalId: TaskSurfaceDismissalId
  }>): Promise<RpcResponse<DismissTaskSurfaceResult>>
}
