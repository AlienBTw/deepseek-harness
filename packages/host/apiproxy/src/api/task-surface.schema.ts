/**
 * taskSurface domain zod schemas. Request and value shapes mirror the
 * Task Surface service outcomes; branded ids cast at the schema boundary.
 */

import { z } from 'zod'
import type {
  TaskSurfaceDismissalId,
  TaskSurfaceId,
  TaskSurfaceSubmissionId,
} from '@maple/task-surface/types'
import type { RequestPayload, ResponseValue } from './index.ts'
import type { Wire } from './rpc.schema.ts'
import { messageIdSchema, sessionIdSchema } from './sessions.schema.ts'

/** TaskSurfaceId: one brand cast after non-empty string validation. */
export const taskSurfaceIdSchema = z.string().min(1) as unknown as z.ZodType<TaskSurfaceId>

/** TaskSurfaceSubmissionId: one brand cast after non-empty string validation. */
export const taskSurfaceSubmissionIdSchema = z.string().min(1) as unknown as z.ZodType<TaskSurfaceSubmissionId>

/** TaskSurfaceDismissalId: one brand cast after non-empty string validation. */
export const taskSurfaceDismissalIdSchema = z.string().min(1) as unknown as z.ZodType<TaskSurfaceDismissalId>

const taskSurfaceOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  description: z.string().optional(),
})

const taskSurfaceBlockSchema = z.union([
  z.object({ kind: z.literal('markdown'), text: z.string() }),
  z.object({ kind: z.literal('metric'), label: z.string(), value: z.string(), hint: z.string().optional() }),
  z.object({ kind: z.literal('diff'), filename: z.string(), original: z.string(), modified: z.string() }),
  z.object({ kind: z.literal('table'), headers: z.array(z.string()), rows: z.array(z.array(z.string())) }),
])

const taskSurfaceFieldSchema = z.union([
  z.object({
    kind: z.literal('choice'),
    id: z.string().min(1),
    label: z.string(),
    options: z.array(taskSurfaceOptionSchema),
    multiple: z.boolean().optional(),
    required: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('text'),
    id: z.string().min(1),
    label: z.string(),
    placeholder: z.string().optional(),
    required: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('order'),
    id: z.string().min(1),
    label: z.string(),
    items: z.array(taskSurfaceOptionSchema),
    required: z.boolean().optional(),
  }),
])

const taskSurfaceSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  layout: z.enum(['stack', 'grid-2', 'grid-3']).optional(),
  blocks: z.array(taskSurfaceBlockSchema),
})

/** Normalized Task Surface model (v1) carried on active reads. */
export const taskSurfaceModelV1Schema = z.object({
  version: z.literal(1),
  title: z.string(),
  description: z.string().optional(),
  sections: z.array(taskSurfaceSectionSchema),
  fields: z.array(taskSurfaceFieldSchema).optional(),
  submit: z.object({ label: z.string() }),
})

const taskSurfacePendingSubmissionSchema = z.object({
  submissionId: taskSurfaceSubmissionIdSchema,
  messageId: messageIdSchema,
  phase: z.union([z.literal('queued'), z.literal('claiming')]),
})

const taskSurfaceActiveValueSchema = z.object({
  active: z.literal(true),
  callId: z.string().min(1),
  surfaceId: taskSurfaceIdSchema,
  model: taskSurfaceModelV1Schema,
  pending: z.union([taskSurfacePendingSubmissionSchema, z.null()]),
})

const taskSurfaceInactiveValueSchema = z.object({
  active: z.literal(false),
  reason: z.literal('not-open'),
})

/** taskSurface.getActive request payload. */
export const taskSurfaceGetActiveRequestSchema = z.object({
  sessionId: sessionIdSchema,
  surfaceId: taskSurfaceIdSchema.optional(),
}) as unknown as z.ZodType<Wire<RequestPayload<'taskSurface.getActive'>>>

/** taskSurface.getActive response value. */
export const taskSurfaceGetActiveValueSchema = z.union([
  taskSurfaceActiveValueSchema,
  taskSurfaceInactiveValueSchema,
]) as unknown as z.ZodType<Wire<ResponseValue<'taskSurface.getActive'>>>

/** taskSurface.submit request payload. */
export const taskSurfaceSubmitRequestSchema = z.object({
  sessionId: sessionIdSchema,
  surfaceId: taskSurfaceIdSchema,
  submissionId: taskSurfaceSubmissionIdSchema,
  values: z.record(z.string(), z.unknown()),
  note: z.string().optional(),
}) as unknown as z.ZodType<Wire<RequestPayload<'taskSurface.submit'>>>

/** taskSurface.submit response value. */
export const taskSurfaceSubmitValueSchema = z.union([
  z.object({
    accepted: z.literal(true),
    messageId: messageIdSchema,
    phase: z.union([z.literal('queued'), z.literal('claiming')]),
  }),
  z.object({
    accepted: z.literal(false),
    reason: z.enum(['not-open', 'stale', 'invalid-submission', 'submission-pending']),
  }),
]) as unknown as z.ZodType<Wire<ResponseValue<'taskSurface.submit'>>>

/** taskSurface.dismiss request payload. */
export const taskSurfaceDismissRequestSchema = z.object({
  sessionId: sessionIdSchema,
  surfaceId: taskSurfaceIdSchema,
  dismissalId: taskSurfaceDismissalIdSchema,
}) as unknown as z.ZodType<Wire<RequestPayload<'taskSurface.dismiss'>>>

/** taskSurface.dismiss response value. */
export const taskSurfaceDismissValueSchema = z.union([
  z.object({ dismissed: z.literal(true), eventSeq: z.number().int().nonnegative() }),
  z.object({
    dismissed: z.literal(false),
    reason: z.enum(['not-open', 'submission-pending']),
  }),
]) as unknown as z.ZodType<Wire<ResponseValue<'taskSurface.dismiss'>>>
