/**
 * Core type contracts for Task Surface models, projections, and service APIs.
 * @module @maple/task-surface/types
 */

import type { CallId, MessageId } from '@maple/llm'
import type { JsonValue, SessionId } from '@maple/session/types'
import type { TaskSurfaceDismissalId, TaskSurfaceId, TaskSurfaceSubmissionId } from './brand.ts'

export type { TaskSurfaceDismissalId, TaskSurfaceId, TaskSurfaceSubmissionId } from './brand.ts'

/** Correlation carried on Task Surface user messages. */
export interface TaskSurfaceUserCorrelation {
  callId: CallId
  surfaceId: TaskSurfaceId
  submissionId: TaskSurfaceSubmissionId
}

declare module '@maple/llm' {
  interface MessageSourceMap {
    /** User message produced by Task Surface submit with durable correlation. */
    'task-surface-user': {
      kind: 'user'
      taskSurface: TaskSurfaceUserCorrelation
    }
  }
}

declare module '@maple/session/types' {
  interface SessionEventMap {
    /** Appended when an active Task Surface is dismissed by the user without submitting a prompt. */
    'task-surface/dismissed': {
      surfaceId: TaskSurfaceId
      dismissalId: TaskSurfaceDismissalId
    }
  }
}

/** Layout orientation for section content rendering. */
export type TaskSurfaceLayout = 'stack' | 'grid-2' | 'grid-3'

/** Primitive content blocks supported within a Task Surface section. */
export type TaskSurfaceBlock =
  | { kind: 'markdown'; text: string }
  | { kind: 'metric'; label: string; value: string; hint?: string }
  | { kind: 'diff'; filename: string; original: string; modified: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }

/** Option definition for single/multi-choice selection fields. */
export interface TaskSurfaceOption {
  id: string
  label: string
  description?: string
}

/** Interactive input fields for structured user data capture. */
export type TaskSurfaceField =
  | { kind: 'choice'; id: string; label: string; options: TaskSurfaceOption[]; multiple?: boolean; required?: boolean }
  | { kind: 'text'; id: string; label: string; placeholder?: string; required?: boolean }
  | { kind: 'order'; id: string; label: string; items: TaskSurfaceOption[]; required?: boolean }

/** A logical section grouping content blocks and presentation layout. */
export interface TaskSurfaceSection {
  id: string
  title?: string
  layout?: TaskSurfaceLayout
  blocks: TaskSurfaceBlock[]
}

/**
 * Complete declarative Task Surface model specification (v1).
 */
export interface TaskSurfaceModelV1 {
  version: 1
  title: string
  description?: string
  sections: TaskSurfaceSection[]
  fields?: TaskSurfaceField[]
  submit: {
    label: string
  }
}

/** Presentation metadata attached to tool/result events. */
export interface TaskSurfacePresentationMeta {
  kind: 'dsh/task-surface'
  version: 1
  surfaceId: TaskSurfaceId
  model: TaskSurfaceModelV1
}

/** State of a pending Task Surface submission. */
export type TaskSurfaceSubmissionPhase = 'queued' | 'claiming'

/** Tracking entry for an in-flight submission. */
export interface TaskSurfacePendingSubmission {
  submissionId: TaskSurfaceSubmissionId
  messageId: MessageId
  phase: TaskSurfaceSubmissionPhase
}

/** Active surface correlation state. */
export interface TaskSurfaceCorrelation {
  callId: CallId
  surfaceId: TaskSurfaceId
}

/** Request payload for submitting values to an active Task Surface. */
export interface SubmitTaskSurfaceRequest {
  sessionId: SessionId
  surfaceId: TaskSurfaceId
  submissionId: TaskSurfaceSubmissionId
  values: Record<string, JsonValue>
  note?: string
}

/** Wire request for the remote getActive endpoint. */
export interface GetActiveTaskSurfaceRemoteRequest {
  sessionId: SessionId
}

/** Wire body for the remote submit endpoint (session resolved from agent lookup). */
export type SubmitTaskSurfaceRemoteRequest = Omit<SubmitTaskSurfaceRequest, 'sessionId'>

/** Wire body for the remote dismiss endpoint (session resolved from agent lookup). */
export type DismissTaskSurfaceRemoteRequest = Omit<DismissTaskSurfaceRequest, 'sessionId'>

/** Outcome of submitting values to a Task Surface. */
export type SubmitTaskSurfaceResult =
  | { accepted: true; messageId: MessageId; phase: TaskSurfaceSubmissionPhase }
  | { accepted: false; reason: 'not-open' | 'stale' | 'invalid-submission' | 'submission-pending' }

/** Query result when inspecting active Task Surface state. */
export type GetActiveTaskSurfaceResult =
  | {
    active: true
    callId: CallId
    surfaceId: TaskSurfaceId
    model: TaskSurfaceModelV1
    pending: TaskSurfacePendingSubmission | null
  }
  | { active: false; reason: 'not-open' }

/** Request payload for dismissing an active Task Surface. */
export interface DismissTaskSurfaceRequest {
  sessionId: SessionId
  surfaceId: TaskSurfaceId
  dismissalId: TaskSurfaceDismissalId
}

/** Outcome of dismissing a Task Surface. */
export type DismissTaskSurfaceResult =
  | { dismissed: true; eventSeq: number }
  | { dismissed: false; reason: 'not-open' | 'submission-pending' }

/** Session-level active Task Surface projection. */
export interface TaskSurfaceProjection {
  active: TaskSurfaceCorrelation | null
}

declare module '@maple/session-projection/types' {
  interface SessionProjectionStateMap {
    taskSurface: TaskSurfaceProjection
  }
  interface SessionProjectionMap {
    /** Active Task Surface correlation for the session, or null when closed. */
    taskSurface: TaskSurfaceProjection
  }
}
