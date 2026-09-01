/** Session-backed image request projection with quarantine. @module @maple/attachment/request-projection */

import { AttachmentError } from './error.ts'
import {
  classifyAttachmentQuarantineReason,
  formatQuarantinedImagePlaceholder,
  type AttachmentQuarantineReason,
} from './quarantine.ts'
import type { AttachmentId } from './brand.ts'
import type {
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  StoredImageAttachment,
} from './types.ts'

/** Attachment read surface used by request projection. */
export interface RequestProjectionAttachmentStore {
  readImageRequest(
    ref: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment>
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>
}

/** Minimal message shape used to collect durable image references from a request. */
export interface RequestImageMessage {
  readonly content: readonly RequestImageContentBlock[]
}

/** Content block shape accepted by {@link collectRequestImageRefs}. */
export interface RequestImageContentBlock {
  readonly type: string
  readonly attachment?: ImageAttachmentRef
  readonly content?: readonly RequestImageContentBlock[]
}

/** One prepared request image or its quarantined placeholder. */
export type RequestImageEntry =
  | { kind: 'resolved'; version: RequestImageAttachment }
  | { kind: 'quarantined'; ref: ImageAttachmentRef; reason: AttachmentQuarantineReason }

/** One quarantine-related event prefix used by {@link foldAttachmentQuarantine}. */
export interface AttachmentQuarantineEvent {
  readonly type: string
  readonly data: unknown
}

/** Payload for {@link AttachmentQuarantineSession.append} quarantine transitions. */
export interface AttachmentQuarantineRecord {
  readonly attachmentId: AttachmentId
  readonly reason: AttachmentQuarantineReason
}

/** Payload for {@link AttachmentQuarantineSession.append} recovery transitions. */
export interface AttachmentRecoveredRecord {
  readonly attachmentId: AttachmentId
}

/** Session append surface used by request projection and recovery. */
export interface AttachmentQuarantineSession {
  readonly events: readonly AttachmentQuarantineEvent[]
  append(type: 'attachment/quarantine', data: AttachmentQuarantineRecord): unknown
  append(type: 'attachment/recovered', data: AttachmentRecoveredRecord): unknown
}

/**
 * Fold quarantined attachment ids from a session log prefix.
 * @param events - session log or prefix.
 * @param end - fold `events[0, end)`; defaults to the whole log.
 * @returns the quarantined ids and their latest failure class.
 */
export function foldAttachmentQuarantine(
  events: readonly AttachmentQuarantineEvent[],
  end = events.length,
): ReadonlyMap<AttachmentId, AttachmentQuarantineReason> {
  const quarantined = new Map<AttachmentId, AttachmentQuarantineReason>()
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index += 1
    if (event.type === 'attachment/quarantine') {
      const data = event.data as AttachmentQuarantineRecord
      quarantined.set(data.attachmentId, data.reason)
    } else if (event.type === 'attachment/recovered') {
      const data = event.data as AttachmentRecoveredRecord
      quarantined.delete(data.attachmentId)
    }
  }
  return quarantined
}

/**
 * Collect unique durable image references from request messages in first-seen order.
 * @param messages - provider request messages after offload.
 * @returns ordered unique references.
 */
export function collectRequestImageRefs(messages: readonly RequestImageMessage[]): ImageAttachmentRef[] {
  const refs = new Map<AttachmentId, ImageAttachmentRef>()
  for (const message of messages) collectRequestImageRefsFromContent(message.content, refs)
  return [...refs.values()]
}

function collectRequestImageRefsFromContent(
  content: readonly RequestImageContentBlock[],
  refs: Map<AttachmentId, ImageAttachmentRef>,
): void {
  for (const block of content) {
    if (block.type === 'image' && block.attachment !== undefined) {
      refs.set(block.attachment.attachmentId, block.attachment)
    } else if (block.type === 'tool-result' && block.content !== undefined) {
      collectRequestImageRefsFromContent(block.content, refs)
    }
  }
}

/** True when one request-image entry is quarantined instead of resolved. */
export function isQuarantinedRequestImage(entry: RequestImageEntry): entry is Extract<RequestImageEntry, { kind: 'quarantined' }> {
  return entry.kind === 'quarantined'
}

/**
 * Model-visible text for one request-image entry.
 * @param entry - resolved request bytes or a quarantined placeholder.
 * @returns deterministic provider-facing text.
 */
export function requestImageEntryText(entry: RequestImageEntry): string {
  return entry.kind === 'quarantined'
    ? formatQuarantinedImagePlaceholder(entry.ref, entry.reason)
    : `Image ${entry.version.attachment.attachmentId}; request image ${entry.version.width}x${entry.version.height}px.`
}

/**
 * Encoded-byte length used by request offload accounting.
 * @param entry - resolved request bytes or a quarantined placeholder.
 * @returns zero for quarantined placeholders, otherwise the encoded request length.
 */
export function requestImageEntryBytes(entry: RequestImageEntry): number {
  return entry.kind === 'quarantined' ? 0 : entry.version.bytes
}

/**
 * Resolve the request version from one entry.
 * @param entry - a resolved request-image entry.
 * @returns the encoded request version.
 */
export function resolvedRequestImage(entry: RequestImageEntry): RequestImageAttachment {
  if (entry.kind !== 'resolved') {
    throw new AttachmentError(
      `Attachment ${entry.ref.attachmentId} is quarantined (${entry.reason}) and cannot be projected.`,
      'ATTACHMENT_READ_FAILED',
    )
  }
  return entry.version
}

async function readRequestImage(
  attachments: RequestProjectionAttachmentStore,
  ref: ImageAttachmentRef,
  policy: ImageRequestPolicy,
  signal: AbortSignal | undefined,
): Promise<RequestImageAttachment> {
  signal?.throwIfAborted()
  return attachments.readImageRequest(ref, policy, signal)
}

async function projectOneRequestImage(
  attachments: RequestProjectionAttachmentStore,
  ref: ImageAttachmentRef,
  policy: ImageRequestPolicy,
  signal: AbortSignal | undefined,
  quarantined: ReadonlyMap<AttachmentId, AttachmentQuarantineReason>,
  session: AttachmentQuarantineSession | undefined,
): Promise<RequestImageEntry> {
  const knownReason = quarantined.get(ref.attachmentId)
  if (knownReason !== undefined) {
    return { kind: 'quarantined', ref, reason: knownReason }
  }

  try {
    return { kind: 'resolved', version: await readRequestImage(attachments, ref, policy, signal) }
  } catch (error: unknown) {
    signal?.throwIfAborted()
    let reason = classifyAttachmentQuarantineReason(error)
    if (reason === 'read-failed') {
      try {
        return { kind: 'resolved', version: await readRequestImage(attachments, ref, policy, signal) }
      } catch (retryError: unknown) {
        signal?.throwIfAborted()
        reason = classifyAttachmentQuarantineReason(retryError)
        if (reason === null) throw retryError
        error = retryError
      }
    } else     if (reason === null) {
      throw error
    }
    if (session === undefined) {
      throw error
    }
    if (!foldAttachmentQuarantine(session.events).has(ref.attachmentId)) {
      session.append('attachment/quarantine', { attachmentId: ref.attachmentId, reason })
    }
    return { kind: 'quarantined', ref, reason }
  }
}

/**
 * Prepare request images while folding quarantine state and recording new failures.
 * @param messages - request messages whose image references should be projected.
 * @param attachments - durable attachment store.
 * @param policy - route pixel and encoded-byte budgets.
 * @param signal - optional cancellation for reads and retries.
 * @param session - live session used to append quarantine transitions; omission fails loud on unreadable refs.
 * @returns prepared entries keyed by attachment id.
 */
export async function prepareRequestImages(
  messages: readonly RequestImageMessage[],
  attachments: RequestProjectionAttachmentStore,
  policy: ImageRequestPolicy,
  signal?: AbortSignal,
  session?: AttachmentQuarantineSession,
): Promise<Map<AttachmentId, RequestImageEntry>> {
  const orderedRefs = collectRequestImageRefs(messages)
  const quarantined = session === undefined ? new Map<AttachmentId, AttachmentQuarantineReason>() : foldAttachmentQuarantine(session.events)
  const entries = await Promise.all(orderedRefs.map(
    ref => projectOneRequestImage(attachments, ref, policy, signal, quarantined, session),
  ))
  const projected = new Map<AttachmentId, RequestImageEntry>()
  for (const [index, ref] of orderedRefs.entries()) {
    projected.set(ref.attachmentId, entries[index] as RequestImageEntry)
  }
  return projected
}

/**
 * Verify one attachment and clear its quarantine when the session log records it.
 * @param session - session that receives `attachment/recovered` after verification.
 * @param attachments - durable attachment store.
 * @param ref - image reference from the session log.
 * @param signal - optional cancellation for read and verification work.
 * @returns verified stored bytes and reference metadata.
 */
export async function recoverQuarantinedAttachment(
  session: AttachmentQuarantineSession,
  attachments: RequestProjectionAttachmentStore,
  ref: ImageAttachmentRef,
  signal?: AbortSignal,
): Promise<StoredImageAttachment> {
  const stored = await attachments.readImage(ref, signal)
  if (foldAttachmentQuarantine(session.events).has(ref.attachmentId)) {
    session.append('attachment/recovered', { attachmentId: ref.attachmentId })
  }
  return stored
}
