# @maple/compaction-recallable

English | [中文](README.zh.md)

Recallable compaction backend for the Maple Harness. It splits stale history into frozen index stubs plus one mutable state checkpoint, appends deterministic recall footers, and refuses commits when total measured context would not shrink.

## Model experience

- **Frozen index stubs** — newly stale history is chunked toward `chunkTokens`; each chunk becomes a short index card (`stubTokens`) that is never rewritten and never re-enters a later compaction region.
- **State checkpoint** — one mutable working-memory document after all stubs; each pass rewrites it from the prior state plus this pass's staled content.
- **Layout** — after every completed pass the request prefix is `[stubs…][state][tail]`. A mid-commit crash leaves a left-to-right stub prefix; the next pass resumes remaining regions unconditionally.
- **Checkpoint footers** — every replacement ends with `[checkpoint c<seq>: shadows conversation span #<start>–#<end>; originals retrievable via history_read]`.
- **Inflation guard** — a pass aborts before any commit when estimated total context after replacement is not strictly smaller than before (skipped only while finishing an incomplete pass).
- **Recall pairing** — compose with `@maple/tool-recall` so shadowed spans remain reachable through `history_read` and `history_search`.

## Configuration

Extends the `BasicCompactionConfig` surface with:

| Field | Default | Role |
| --- | --- | --- |
| `chunkTokens` | `2048` | Target budget per frozen index-stub chunk |
| `stubTokens` | `256` | Soft generation budget for one index stub (`stubTokens/chunkTokens` ≤ 0.25) |

## Known Limitations and Deferred Work

- Guard degradation ladder, stub echo detection, amortized pre-step stub drafting, and semantic search fallback remain deferred follow-ups from the recallable-compaction Agent Note.
- Cross-session recall stays on the session-query surface; in-session `history_search` uses a bounded inverted index and optional session-query FTS when SQLite is mounted.
