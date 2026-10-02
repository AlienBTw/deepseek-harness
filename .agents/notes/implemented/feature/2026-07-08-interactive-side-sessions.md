# Agent Note: Interactive side sessions and merge-back

Status: implemented

English | [中文](2026-07-08-interactive-side-sessions.zh.md)

## Problem

A user may want to explore a question from a live session without changing its main context. Existing primitives do not expose that product shape: [session-store fork](../../implemented/feature/2026-06-30-session-store-fork-api.md) creates an unattached session, while [fork subagents](../../implemented/feature/2026-06-21-subagent-capability-seam.md) are model-driven tasks whose transcript collapses into one tool result. Neither gives the user a separate conversation, and neither records a conclusion in the parent together with the side session that produced it.

## Decision

A **side session** is an ordinary live session forked at the source's last completed turn, attached to its own agent, framed as a read-only advisor, and able to **merge back** one condensed note. Ownership lives in `@maple/sidechat` (`ctx.sidechat`).

- **Fork and attach:** `ctx.sidechat.fork(parent)` creates the child with the parent's balanced completed-turn prefix through `ctx.agents.create({ seed, meta })`, stamping `parentSession`, `seedLength`, and `origin: 'sidechat'`. No core session-store method was added.
- **Advisor framing:** after publication, exactly one plugin-sourced `user/message` (`plugin: sidechat`, notice form) is appended after the seed (and the automatic `session/end-seed`). The system prompt stays byte-identical so the provider prefix cache over inherited history remains valid.
- **Hard read-only:** a `tools/pre-execute` listener denies every tool on a `origin: 'sidechat'` agent unless the visible definition's `isConcurrencySafe` returns exact `true` (execution mode `parallel`). Ordinary and subagent sessions are unaffected.
- **Merge-back:** `ctx.sidechat.mergeBack(parent, child, note?)` appends one length-capped `user/message` with source `plugin: sidechat` to the parent. Omitting `note` uses the child's latest assistant text. Config `mergeMaxChars` (default 2000) bounds each handback. The next parent request sees the note at its logged position without a new session event type.
- **Presentation:** Web session switching and handback rendering are deferred to the first bound UI; this change ships Host mechanics and unit coverage only. Snapshot coverage lands with that UI.

Rewind productization, session-tree views, a model-facing side-session tool, and `forkName`/`mergedInto` metadata remain out of scope.

## Alternatives considered

- **Use the subagent seam:** rejected because side sessions are user-driven, client-visible, and may outlive a parent turn; subagents are model-driven runs returning one tool result.
- **Change the child system prompt:** rejected by default because any byte change invalidates the prefix cache from token zero. Deployments may still prefer that stronger separation.
- **Add `sidechat/*` events:** deferred because a sourced `user/message` already records the content, producer, and replay input durably. A dedicated event is justified only by a client that needs distinct rendering.
- **Bind a protocol API now:** rejected because current UIs are client-owned. Live presentation must eventually derive from the durable message so replay renders the same record. Host RPC wrappers for `ctx.sidechat` follow with the first Web switcher.
- **Advisory-only read-only:** rejected for this landing; the deny gate is hard via `tools/pre-execute`.

## Consequences

`SessionHeader.origin` is `'subagent' | 'sidechat'`. Sidechat children remain visible in ordinary session lists (unlike subagent-origin rows). Persistence JSONL/SQLite and Host summary schemas accept the new origin. The base bundle mounts `@maple/sidechat`. Unit tests cover fork/attach, merge-back capping, and the deny gate; Web snapshot coverage waits on the client switcher.
