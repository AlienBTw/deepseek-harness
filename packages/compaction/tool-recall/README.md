# @maple/tool-recall

English | [中文](README.zh.md)

Model-facing `history_read` and `history_search` recall tools for the Maple Harness. These tools allow agents to retrieve original conversation spans that have been compacted, ensuring no historical context is permanently unreachable.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`history_read` and `history_search` schemas](../../../docs/tool-catalog.md#mapletool-recall).

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from these schemas.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains its requested parameters in arguments. `history_read` returns paginated shadowed spans with sequence numbers and line boundaries; `history_search` returns matching snippets with checkpoint IDs, sequence numbers, and coverage metadata (`scanned`/`matched`/`truncated`/`mode`). Search uses a bounded in-memory inverted index over shadowed transcripts, and optionally accelerates candidates through `sessionQuery` FTS when that service is mounted.

#### Token effect

Tool call arguments and returned transcript snippets add tokens to the history tail until compacted.

#### KV Cache effect

Appends linearly to the turn transcript without prefix invalidation.

## Known Limitations and Deferred Work

- Search is currently a case-insensitive literal scan over in-memory session logs.
