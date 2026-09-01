import { Context } from '@maple/cordis'
import SessionStore, { SessionId, type Session } from '@maple/session'
import { describe, expect, it, vi } from 'vitest'
import AttachmentStore, {
  AttachmentError,
  AttachmentId,
  ImageVariantId,
  type ImageAttachmentRef,
  type ImageRequestPolicy,
  type RequestImageAttachment,
  type StoredImageAttachment,
} from '../src/index.ts'
import {
  foldAttachmentQuarantine,
  prepareRequestImages,
  recoverQuarantinedAttachment,
} from '../src/request-projection.ts'

const POLICY: ImageRequestPolicy = { maxPixels: 640_000, maxBytes: 1_024_000 }

const REF: ImageAttachmentRef = {
  attachmentId: AttachmentId('sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'),
  mediaType: 'image/png',
  bytes: 4,
  width: 2,
  height: 2,
  name: 'shot.png',
}

const VERSION: RequestImageAttachment = {
  variantId: ImageVariantId('sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  attachment: REF,
  data: Uint8Array.of(1, 2, 3, 4),
  mediaType: 'image/png',
  bytes: 4,
  width: 2,
  height: 2,
  depth: 'uchar',
  space: 'srgb',
  hasAlpha: false,
}

class ProjectionStore extends AttachmentStore {
  readonly imageLimits = {
    maxImageBytes: 10,
    maxImagesPerMessage: 2,
    maxMessageImageBytes: 10,
    maxImagePixels: 10,
    maxImageDimension: 10,
    mediaTypes: ['image/png'] as const,
  }

  override readonly readImageRequest = vi.fn(async (): Promise<RequestImageAttachment> => VERSION)
  override readonly readImage = vi.fn(async (): Promise<StoredImageAttachment> => ({ ref: REF, data: VERSION.data }))

  validateImage(): Promise<void> {
    return Promise.resolve()
  }

  saveImage(): Promise<ImageAttachmentRef> {
    throw new Error('not used')
  }
}

async function sessionWith(events: Session['events'] = []): Promise<Session> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  return ctx.sessions.create(SessionId('attachment-quarantine'), { seed: [...events] })
}

describe('foldAttachmentQuarantine', () => {
  it('tracks quarantine and recovery transitions', async () => {
    const session = await sessionWith()
    session.append('attachment/quarantine', { attachmentId: REF.attachmentId, reason: 'not-found' })
    session.append('attachment/recovered', { attachmentId: REF.attachmentId })
    session.append('attachment/quarantine', { attachmentId: REF.attachmentId, reason: 'corrupt' })

    expect(foldAttachmentQuarantine(session.events).get(REF.attachmentId)).toBe('corrupt')
    const recoveredIndex = session.events.findIndex(event => event.type === 'attachment/recovered') + 1
    expect(foldAttachmentQuarantine(session.events, recoveredIndex).has(REF.attachmentId)).toBe(false)
  })
})

describe('prepareRequestImages', () => {
  it('skips reads for folded quarantine state', async () => {
    const session = await sessionWith()
    session.append('attachment/quarantine', { attachmentId: REF.attachmentId, reason: 'not-found' })
    const store = new ProjectionStore(new Context())
    store.readImageRequest.mockRejectedValueOnce(new Error('should not read'))

    const projected = await prepareRequestImages(
      [{ content: [{ type: 'image', attachment: REF }] }],
      store,
      POLICY,
      undefined,
      session,
    )

    expect(store.readImageRequest).not.toHaveBeenCalled()
    expect(projected.get(REF.attachmentId)).toEqual({
      kind: 'quarantined',
      ref: REF,
      reason: 'not-found',
    })
  })

  it('records quarantine once for missing attachments and reprojects without reading', async () => {
    const session = await sessionWith()
    const store = new ProjectionStore(new Context())
    store.readImageRequest.mockRejectedValue(
      new AttachmentError('missing', 'ATTACHMENT_NOT_FOUND'),
    )

    const first = await prepareRequestImages(
      [{ content: [{ type: 'image', attachment: REF }] }],
      store,
      POLICY,
      undefined,
      session,
    )
    const second = await prepareRequestImages(
      [{ content: [{ type: 'image', attachment: REF }] }],
      store,
      POLICY,
      undefined,
      session,
    )

    expect(first.get(REF.attachmentId)?.kind).toBe('quarantined')
    expect(second.get(REF.attachmentId)?.kind).toBe('quarantined')
    expect(session.events.filter(event => event.type === 'attachment/quarantine')).toHaveLength(1)
    expect(store.readImageRequest).toHaveBeenCalledTimes(1)
  })

  it('retries read-failed once before quarantining', async () => {
    const session = await sessionWith()
    const store = new ProjectionStore(new Context())
    store.readImageRequest
      .mockRejectedValueOnce(new AttachmentError('io', 'ATTACHMENT_READ_FAILED'))
      .mockRejectedValueOnce(new AttachmentError('io', 'ATTACHMENT_READ_FAILED'))

    const projected = await prepareRequestImages(
      [{ content: [{ type: 'image', attachment: REF }] }],
      store,
      POLICY,
      undefined,
      session,
    )

    expect(projected.get(REF.attachmentId)?.kind).toBe('quarantined')
    expect(store.readImageRequest).toHaveBeenCalledTimes(2)
    expect(session.events.at(-1)?.type).toBe('attachment/quarantine')
  })

  it('does not quarantine cancellation or unclassified failures', async () => {
    const session = await sessionWith()
    const store = new ProjectionStore(new Context())
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))
    store.readImageRequest.mockRejectedValueOnce(new AttachmentError('io', 'ATTACHMENT_READ_FAILED'))

    await expect(prepareRequestImages(
      [{ content: [{ type: 'image', attachment: REF }] }],
      store,
      POLICY,
      abort.signal,
      session,
    )).rejects.toThrow('cancelled')
    expect(session.events.some(event => event.type === 'attachment/quarantine')).toBe(false)

    store.readImageRequest.mockRejectedValueOnce(new Error('foreign'))
    await expect(prepareRequestImages(
      [{ content: [{ type: 'image', attachment: REF }] }],
      store,
      POLICY,
      undefined,
      session,
    )).rejects.toThrow('foreign')
    expect(session.events.some(event => event.type === 'attachment/quarantine')).toBe(false)
  })

  it('fails loud without a session when reads fail', async () => {
    const store = new ProjectionStore(new Context())
    store.readImageRequest.mockRejectedValue(new AttachmentError('missing', 'ATTACHMENT_NOT_FOUND'))

    await expect(prepareRequestImages(
      [{ content: [{ type: 'image', attachment: REF }] }],
      store,
      POLICY,
    )).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' })
  })

  it('collects nested tool-result images', async () => {
    const store = new ProjectionStore(new Context())
    const projected = await prepareRequestImages(
      [{
        content: [{
          type: 'tool-result',
          content: [{ type: 'image', attachment: REF }],
        }],
      }],
      store,
      POLICY,
    )

    expect(projected.get(REF.attachmentId)?.kind).toBe('resolved')
    expect(store.readImageRequest).toHaveBeenCalledOnce()
  })
})

describe('recoverQuarantinedAttachment', () => {
  it('appends recovery only after verified read', async () => {
    const session = await sessionWith()
    session.append('attachment/quarantine', { attachmentId: REF.attachmentId, reason: 'read-failed' })
    const store = new ProjectionStore(new Context())

    const stored = await recoverQuarantinedAttachment(session, store, REF)

    expect(stored.ref).toEqual(REF)
    expect(session.events.at(-1)).toMatchObject({
      type: 'attachment/recovered',
      data: { attachmentId: REF.attachmentId },
    })
    expect(foldAttachmentQuarantine(session.events).has(REF.attachmentId)).toBe(false)
  })

  it('does not append recovery when the attachment was never quarantined', async () => {
    const session = await sessionWith()
    const store = new ProjectionStore(new Context())

    await recoverQuarantinedAttachment(session, store, REF)

    expect(session.events.some(event => event.type === 'attachment/recovered')).toBe(false)
  })
})
