# @maple/compaction-recallable

English | [中文](README.zh.md)

Recallable compaction backend for the Maple Harness. It extends the basic compaction policy with deterministic checkpoint footers that point models at `history_read`, and an inflation guard that refuses commits when total measured context would not shrink.

## Model experience

- **Checkpoint footers** — every replacement checkpoint ends with `[checkpoint c<seq>: shadows conversation span #<start>–#<end>; originals retrievable via history_read]`.
- **Inflation guard** — a compaction attempt aborts before commit when estimated total context after replacement is not strictly smaller than before.
- **Recall pairing** — compose with `@maple/tool-recall` so shadowed spans remain reachable through `history_read` and `history_search`.

## Configuration

Uses the same `BasicCompactionConfig` surface as `@maple/compaction-basic`.

## Known Limitations and Deferred Work

- Index stubs, frozen multi-checkpoint layouts, and state-checkpoint rewriting from the recallable-compaction design remain future work; this package ships the basic single-checkpoint path with recall footers and inflation protection.
