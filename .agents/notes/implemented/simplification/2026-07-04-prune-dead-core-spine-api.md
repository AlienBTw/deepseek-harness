# Agent Note: Prune dead public API and result fields

Status: implemented

English | [中文](2026-07-04-prune-dead-core-spine-api.zh.md)

## Problem

Several package-root exports, result fields, and convenience methods have no production consumer. They survive because tests import internals through public entry points or because a type anticipated a caller that never arrived. Each item is small in isolation, but together they enlarge the SDK contract, generated catalogs, documentation, and regression matrix without enabling a shipped path.

The production corpus is `packages/*/*/src`, example sources/config, and runtime scripts. Tests, package READMEs, and Agent Note prose are evidence of publication but not fixed callers. `cordis_inspect` makes `packages/extensions/tool-cordis/src/api-catalog.ts` model-visible, and `cordis_mount` can invoke injected services through guarded real-service proxies, so catalogued service methods and returned shapes are a genuine dynamic product surface. The table therefore distinguishes absence of a fixed repository caller from unreachability: rows touching catalogued vocabulary intentionally contract what model-written mounts can discover and call, while package-root implementation helpers are not reached through that service façade.

## Decision

This first slice contracts the highest-leverage unread result fields and confirms several inventory rows already absent:

- **`CompactionResult`** no longer echoes `startSeq`, `summarySeq`, `endSeq`, or `summary`. Callers keep `compactionId`, optional `sourceCommandId`, `shadowedRange`, `shadowedSeqs`, and `shadowedTokenCount`. Durable summary content and bookkeeping-event seqs live only on the session log (`compaction/start` / `compaction/summary` / `compaction/end`). `/compact` derives `command/done.sourceEventSeq` by locating the matching `compaction/summary` for `result.compactionId`. Basic and recallable region builders return the narrowed result after appending the close event.
- **`LlmError` / `LlmFailure` / `LlmErrorOptions`** no longer carry HTTP `status`. Adapters classify with stable `code` (and optional `providerRetryAfterMs` / `requestId`); replay and retry invariants no longer validate or round-trip status.
- **`BlockAssembler.push()`** already returns `void`; production callers use `blocks()` / `message()`.
- **`SurfaceManager.invalidate()`** and **`ToolExecutionResult.callId`** are already absent; call identity stays on `ToolExecution`.
- **`ReactLoopAgent`** is not re-exported from `@maple/agent-loop`'s package root; the concrete class remains file-local for the plugin. Outside packages program against `Agent` and create/resume through `ctx.agents`.

## Deferred

The remaining inventory from the original proposal is unfinished and stays in scope for later slices:

- Package-root demotions: `workflow-worker-thread` protocol/runtime/session re-exports and named `WorkerThreadWorkflowEngine`; `code-runtime-worker` protocol/bootstrap re-exports; ACP `agentOptions`; `providerWording` / `completedTurnPrefix`; `depthOf` / `SubagentDepthError` / `waitForExit` / `exitsWithin`; persistence `inits` accessors, `seedCoversPrefix`, and `assertSerializable`.
- Further contractions: `compactRegion`'s separate `session` argument; `BasicCompactionEngine` estimation/summarization visibility; `CodeLogEntry.source`/`level` and `RunCodeMeta.dispatches`; `CodeRuntime.language` / `isolation`; `ToolNotFoundError.toolName`, `SystemPrompt.config`, and `BashTask.command`.
- Grouped helper-export inventories for LLM deepseek/pi-ai, bash/sandbox, fs-local, web fetch/search, tool-fs, tool-web, tool-call-timeout-policy, compaction-basic `resolveConfig`, and tool-bash `renderResult`.

## Alternatives considered

**Keep test conveniences and self-contained results public.** Public helpers can make white-box tests convenient, self-contained result fields can look ergonomic, and future embedders might want the concrete loop or enumeration methods. Those benefits are hypothetical; today they make every implementation and document explain states that no shipped caller can observe. A real consumer can introduce the smallest contract it needs, with its ownership and failure semantics known.

**Keep every catalogued member for model-written mounts.** The self-referential toolset is a real generic consumer route, not generated-doc noise. Its value comes from an accurate, composable service API, however, not from preserving duplicate fields or incoherent argument pairs indefinitely; each catalogued contraction removes a fact available elsewhere on the same execution, agent, or result and updates the API reference in the same change.

**Finish the entire inventory in one pass.** The helper-export list spans many packages and test entry points. Landing the unread result fields first keeps the catalog and document surface honest without blocking later demotions.

## Consequences

- Compaction callers and `/compact` presentation must read summary content and event seqs from the session log (or shadowed accounting on the result), not from echoed result fields.
- LLM failure payloads no longer advertise raw HTTP status; routing stays on `code` / message classification.
- External pre-release embedders and model-written mounts see a narrower `CompactionResult` and `LlmFailure` in generated catalogs.
- Deferred rows remain publishable until later slices demote or delete them; this note stays the owner and is updated as each slice ships.
