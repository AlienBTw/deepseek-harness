# Agent Note: Quarantine unreadable historical attachments

Status: implemented

English | [中文](2026-08-20-attachment-read-quarantine.zh.md)

## Problem

An admitted `ImageAttachmentRef` remains in durable history and therefore participates in every later request until compaction replaces it. `AttachmentStore.readImage()` fails with `ATTACHMENT_NOT_FOUND`, `ATTACHMENT_CORRUPT`, or `ATTACHMENT_READ_FAILED` when the referenced object disappears, fails integrity verification, or cannot be read. The unchanged history then makes every later model request fail on the same object, leaving the session unable to continue even though the remaining messages are usable. This is the unavailable-object case left fail-loud by [reconstructable requests](../../implemented/architecture/2026-07-05-reconstructable-requests.md).

## Decision

A shared request-projection consumer in `@maple/attachment` folds quarantine state from the session log and prepares request images before provider dispatch. `ATTACHMENT_NOT_FOUND` and `ATTACHMENT_CORRUPT` immediately append `attachment/quarantine`; `ATTACHMENT_READ_FAILED` receives one cancellation-aware read retry and appends the same event with a retryable reason if the retry fails. Cancellation and unclassified failures do not quarantine data.

Quarantined references project to deterministic placeholders in model requests. Recovery via `recoverQuarantinedAttachment` verifies bytes through `readImage()` and appends `attachment/recovered`. Session event types are merged on `SessionEventMap` in `@maple/session` (the attachment package cannot reference session without a TypeScript project cycle through `@maple/llm`). DeepSeek and Pi adapters call the shared consumer with `ctx.get('sessions')?.get(sessionId)` for live quarantine recording.

## Alternatives considered

- **Keep failing every request.** This preserves strict error reporting but makes an otherwise usable durable session permanently unavailable after one storage fault.
- **Delete or rewrite the historical image block.** That loses evidence, violates append-only history, and prevents a repaired content-addressed object from restoring the original request.
- **Catch the error independently in each adapter.** An unlogged placeholder would make replay depend on which adapter and storage state happened to be present, while duplicated policies would drift.
- **Replace missing or corrupt bytes automatically.** The reference names verified immutable content; substituting different bytes under that identity would defeat integrity checking.

## Consequences

Unreadable historical images no longer brick subsequent turns. Quarantine and recovery are model-visible through durable events and placeholder text. Adapters without a live session still fail loud on unreadable refs rather than silently skipping quarantine recording.

## Verification

- `packages/attachment/attachment/tests/request-projection.spec.ts` covers classification, idempotent quarantine, retry, recovery, and nested tool-result images.
- `packages/llm/llm-deepseek/tests/adapter.spec.ts` covers quarantined placeholders with a live session.
- Recovery is exposed through apiproxy `session.attachment` with `recover: true`.

## Risks

Quarantine and recovery each change the provider prefix once. The implementation must identify the exact failing reference before recording state and must coordinate concurrent requests so duplicate failures produce one effective transition. Auxiliary calls without a live session cannot record recovery state; their failure policy remains explicit implementation scope rather than an adapter fallback.
