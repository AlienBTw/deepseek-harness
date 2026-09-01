/** Attachment quarantine and placeholder formatting. @module @maple/attachment/quarantine */

import { AttachmentError } from './error.ts'
import type { ImageAttachmentRef } from './types.ts'

/** Failure class recorded when an image attachment cannot be read from storage. */
export type AttachmentQuarantineReason = 'not-found' | 'corrupt' | 'read-failed'

/**
 * Classify a storage read error into a standard quarantine reason.
 * @param error - failure encountered during image read or request projection.
 * @returns the classified quarantine reason, or null if unclassified.
 */
export function classifyAttachmentQuarantineReason(error: unknown): AttachmentQuarantineReason | null {
  if (error instanceof AttachmentError) {
    switch (error.code) {
      case 'ATTACHMENT_NOT_FOUND':
        return 'not-found'
      case 'ATTACHMENT_CORRUPT':
        return 'corrupt'
      case 'ATTACHMENT_READ_FAILED':
        return 'read-failed'
      default:
        return null
    }
  }
  return null
}

/**
 * Format a deterministic placeholder string representing a quarantined image reference in model context.
 * @param ref - the unreadable image attachment reference.
 * @param reason - the classified failure reason.
 * @returns deterministic model-visible placeholder text.
 */
export function formatQuarantinedImagePlaceholder(
  ref: ImageAttachmentRef,
  reason: AttachmentQuarantineReason,
): string {
  const prefix = ref.attachmentId.slice(0, 8)
  const nameSuffix = ref.name ? `: ${ref.name}` : ''
  return `[quarantined image attachment ${prefix} (${reason}${nameSuffix})]`
}
