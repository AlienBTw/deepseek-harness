# Agent Note: Record last activity in the session index

Status: implemented

English | [中文](2026-07-29-durable-last-activity-index.zh.md)

## Problem

A cold (persisted, unattached) session had no authoritative stored answer to "when did the user last prompt here". `dsh-host-apiproxy` served `updatedAt` from the optional projection cache's `lastPromptAt`, falling back to `createdAt`, and the Web client sorted its Session tree by that value. The cache is fail-soft and checkpointed asynchronously, so a missing or delayed row made a recently prompted Session sort too old.

The gateway previously used JSONL artifact mtime when available. mtime answers a different question: when the artifact was last written. Every durable write refreshes it, including a truncate-repair of a torn tail, synthetic closers that balance an interrupted turn, and the [`session/end-seed` boundary](./2026-07-30-session-end-seed-log-boundary.md) appended during pickup. That approximation promoted a Session merely because it was opened. The [bounded cold blank verification](../bug-fix/2026-08-13-bounded-cold-blank-verification.md) removed mtime ordering and accepted the cache's conservative "too old" failure direction as an interim tradeoff.

An attached summary can fold the live event log and select the latest human-authored `user/message`, but the cold path deliberately does not read large logs. Reading every log to compute `updatedAt` would make `list()` scale with total conversation bytes rather than Session count.

## Decision

Store the latest human-prompt time in the Session index so `summarizeCold()` can serve it without opening the log or depending on a cache checkpoint. The coordinator folds each append batch with the shared predicate and passes the updated value on `SessionHeader.lastPromptAt`; backends persist it.

The shared rule is one exported reducer/predicate in `@maple/session-persistence`: a `user/message` whose `source.kind` is `user`. Attached Session-list metadata and both backends use that definition so new message-source variants cannot make attached and cold ordering disagree.

Pre-field artifacts omit the value. Listing treats absence as `createdAt` (honest; not mtime). Existing pickers and trees reorder once on upgrade toward creation time until each session receives a new human prompt under this build.

The two shipped backends persist the index asymmetrically:

- **SQLite** stores `last_prompt_at` on `sessions`, written in the same transaction as `appendBatch`, with a monotonic `SCHEMA_VERSION` bump to 18. Old on-disk versions are refused.
- **JSONL** cannot mutate the immutable header line. After each successful append batch it atomically publishes a per-session `session.activity` sidecar (`seq` + `lastPromptAt`). `list()` merges the sidecar into the returned header without opening the log. `open`/`loadStored` reconciles the sidecar to the log tip (rewrite when `seq` disagrees or the file is missing) or falls back to folding the log / `createdAt`.

Cold `SessionSummary.updatedAt` reads the durable index first, then an exact small-artifact probe fold when present, then `createdAt`. Projection-cache recency hints are not used for cold `updatedAt`; cache rows still inform blankness.

## Alternatives considered

**Read the log on the cold path.** Correct by construction and needs no format change, but it defeats the header-only listing: `list()` would scale with total log size, and the web session tree fans out over every session in the store. This is the option the mtime approximation existed to avoid.

**Keep mtime and exclude boundary writes from it.** Rejected as impossible rather than undesirable: mtime is the filesystem's, not the backend's. Nothing short of restoring the timestamp after every boundary write would preserve it, and that races any concurrent reader and lies about the artifact.

**Write the boundary only when repair occurred.** Would reduce the frequency, and the [boundary note](./2026-07-30-session-end-seed-log-boundary.md) already rejected it: the predicate must hold for an orderly restart too. Trading a correctness invariant for timestamp accuracy is the wrong direction.

**Derive activity from a projection cache.** That was the interim implementation. `session-projection-cache` folds tails past a watermark without changing the persistence format, but it is optional and fail-soft. Its absence or checkpoint delay makes ordering depend on cache availability and freshness, so it cannot provide the authoritative value.

**Mutable JSONL header field.** Rejected: the header is line 1, written once during materialization; committed bytes are never rewritten. A per-append header field would violate that durability invariant.

## Consequences

Cold listing recency is exact for sessions written under this index without opening large logs. Attached and cold orderings share one predicate. Pre-field logs list without error and sort by `createdAt` until prompted again. A crash between a JSONL append and its sidecar write can leave a stale listing value until the next open reconciles the sidecar — the same conservative "too old" direction as the former cache fallback for that narrow window. SQLite databases at schema 17 and below fail loud on open.

## Related

- [Bounded cold blank verification](../bug-fix/2026-08-13-bounded-cold-blank-verification.md) — removes mtime ordering and limits direct cold reads to small-artifact metadata verification.
- [The end-seed log boundary](./2026-07-30-session-end-seed-log-boundary.md) — one of the non-prompt writes that made mtime unsuitable.
- [Session persistence](./2026-06-14-session-persistence.md) — the append-only and never-rewrite invariants that rule out a mutable JSONL header field.
- [Shared persistence write coordinator](./2026-06-18-shared-persistence-write-coordinator.md) — the append path that computes and forwards `lastPromptAt`.
