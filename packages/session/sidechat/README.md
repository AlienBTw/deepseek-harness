# `@maple/sidechat`

English | [中文](README.zh.md)

Interactive side sessions: fork a live parent at its balanced completed-turn prefix into a read-only advisor child, then merge one length-capped handback note into the parent. Decision record: [interactive side sessions](../../../.agents/notes/implemented/feature/2026-07-08-interactive-side-sessions.md).

## Service API

- `ctx.sidechat.fork(parent, options?)` — creates a child through `ctx.agents.create({ seed, meta })` with `parentSession`, `seedLength`, and `origin: 'sidechat'`, then appends one plugin-sourced advisor framing `user/message`. The parent's log is untouched. Throws `SidechatForkError` when no completed turn matches the cut.
- `ctx.sidechat.mergeBack(parent, child, note?)` — appends one length-capped `user/message` with source `plugin: sidechat` to the parent. Omitting `note` uses the child's latest assistant text. Throws `SidechatMergeError` when lineage or note content is invalid.

Config field `mergeMaxChars` (default 2000) bounds each handback.

## Read-only deny gate

A `tools/pre-execute` listener denies every tool call on a `origin: 'sidechat'` agent unless the visible definition's `isConcurrencySafe` classifier returns exact `true` (execution mode `parallel`). Ordinary and subagent sessions are unaffected.

## Model Experience

### Advisor framing

#### What the model sees

Exactly one plugin-sourced notice after the inherited prefix, telling the child to explain without mutating or continuing the parent task. The system prompt stays byte-identical to the parent's so the provider prefix cache over inherited history remains valid.

#### Token effect

One durable framing message in the child log; retained for the child's lifetime.

#### KV Cache effect

Append-only after the inherited prefix; does not invalidate the parent's cached system prompt or seeded history.

### Merge-back

#### What the model sees

The parent receives one notice-form `user/message` (`Side-session handback:` plus the capped note) at its logged position. The next parent request and replay see it there.

#### Token effect

Bounded by `mergeMaxChars` per merge.

#### KV Cache effect

Append-only on the parent; prior prefix cache remains valid.

## Known Limitations and Deferred Work

- **Web UI switcher and handback rendering follow** — this package owns Host mechanics only; client session switching and distinct handback presentation land with the first bound UI (snapshot coverage then).
- **Mutating classification follows `isConcurrencySafe`** — tools that mutate without declaring concurrency safety are denied; a read-only tool that omits the classifier is also denied (fail-closed).
- **No `forkName` / `mergedInto` metadata** — lineage uses existing `parentSession` / `seedLength` / `origin` only.
