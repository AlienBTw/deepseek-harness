# Agent Note: Pre-tool input rewrite — a consistent design

Status: implemented

English | [中文](2026-06-30-pre-tool-input-rewrite.zh.md)

## Problem

The [interception extension-points Agent Note](../feature/2026-06-30-interception-extension-points.md) defines `tools/pre-execute` as an allow/deny/ask gate over an execution whose identity is already protected and whose arguments are deeply frozen. Claude Code's `PreToolUse` hook also offers `updatedInput`, so a faithful bridge needs an explicit rewrite mechanism. A rewrite cannot be a mutation escape hatch on the existing execution object: it must keep the durable history, audit record, presentation, and executed value consistent.

## Decision

A rewrite is a pre-identity consistency transaction owned by the agent loop and declared on `dsh-tools` as the `tools/pre-rewrite` waterfall. The loop resolves it for each model tool call **before** durable `tool/call` commit and **before** the registry mints an immutable `ToolExecution`. After the effective arguments are committed, the ordinary allow/deny/ask pipeline runs unchanged on the sealed identity.

### Settled design choices

1. **Derived history:** surface-replace the step's `assistant/message` tool-call block in place so `deriveMessages()` and the next provider request carry the effective arguments (Claude Code's model: the model sees the rewrite took effect). The shadowed append-origin event retains the model's original emission for human transcript. A separate correction event was rejected as a second model-visible vocabulary for one fact.
2. **Audit sidecar:** `tool/call.arguments` stores the effective raw JSON string; optional `tool/call.originalArguments` retains the model's unparsed emission when a rewrite occurred. Absent when no rewrite ran.
3. **Dedicated earlier extension point:** `tools/pre-rewrite` returns `keep` | `rewrite`. Allow/deny/ask stay on `tools/pre-execute`. Hook bridges run `PreToolUse` once at rewrite time, cache the merged outcome, and map the cached permission decision at `tools/pre-execute` so hooks do not run twice. Direct `ctx.tools.execute()` (no loop) still runs PreToolUse at `tools/pre-execute` only — there is no assistant/message or `tool/call` consistency problem on that path.
4. **Ask interaction:** rewrite completes first; `ask` and monotonic guards observe the rewritten `ToolExecution`. A user approving the call approves what will run; the original emission remains only on the audit sidecar.

### Ordering (pinned)

```text
assistant/message (model emission)
  -> tools/pre-rewrite (+ hook/invoked|hook/result when a bridge runs PreToolUse)
  -> [assistant/message surface replace when rewritten]
  -> tool/call (effective arguments; optional originalArguments)
  -> ToolExecution mint (frozen effective arguments)
  -> tools/pre-execute → guards → tools/execute → …
```

### Bridge mapping

- Claude Code: `updatedInput` replaces the pending arguments wholesale (`tool_input` is the full args object).
- Codex: `updatedInput` follows Codex's `{ command }` exposure — a string `command` splices into object args; otherwise the hook object replaces the pending value. Last non-undefined `updatedInput` across matched hooks wins in `mergeHookOutputs`.

## Alternatives considered

### Why not mutate the execution object?

Allowing a pre-execute listener to assign `exec.arguments` would provide only an execution rewrite, leaving model history, audit, and presentation unchanged. Keeping the identity protected makes such partial behavior unrepresentable.

### Why not fold rewrite into `PreToolDecision`?

By the time `tools/pre-execute` fires, `tool/call` is already logged and `ToolExecution` identity is sealed. Extending that decision cannot update the three readers atomically.

### Why not a separate correction message for derived history?

A second model-visible event would duplicate the tool-call fact and force every consumer to learn an overlay rule. Surface replace reuses the existing compaction/replacement mechanism and matches Claude Code's "rewrite took effect" transcript.

## Consequences

- Native plugins subscribe to `tools/pre-rewrite` for argument transforms and keep allow/deny/ask on `tools/pre-execute`.
- CC/Codex bridges honor `updatedInput` without the prior ignore warning.
- Presentation (`presentCall`/`presentResult`) continues to read `tool/call.arguments`, which now always names what ran.
- Evidence: `packages/core/agent-loop/tests/interception.spec.ts` (`tools/pre-rewrite`); Claude Code / Codex coverage cases for `updatedInput`; `packages/hooks/hook-protocol/tests/merge.spec.ts` for last-wins fold.
