# Agent Note: Required cancellation on the filesystem capability seam

Status: implemented

English | [中文](2026-07-19-required-cancellation-on-filesystem-capability-seam.zh.md)

## Problem

The [tool registry cancellation contract](./2026-07-19-cooperative-tool-cancellation.md) requires `exec.signal` in every tool body, but asynchronous `ctx.fs` operations still accepted an optional signal. A filesystem tool could therefore type-check while dropping cancellation before path resolution, metadata probes, reads, listings, or atomic mutations.

## Decision

Every awaited `FileSystem` primitive reachable while a tool (or other same-process consumer) still owns the operation requires an `AbortSignal`:

- `resolve(path, opts)` requires `opts: { cwd?: string; signal: AbortSignal }`
- `stat`, `lstat`, `readText`, `streamText`, `readBytes`, `listDir`, `writeText`, and `editText` take a required positional `signal`
- `writeText` / `editText` keep `expected` as an explicit `… | undefined` parameter before `signal` (no optional overload; unconditional mutations pass `undefined`)
- Synchronous helpers (`processPath`, `fileUrl`, `contains`, `sandboxMode`) stay signal-free

Providers (`fs-local`, `fs-sandbox`, `fs-e2b`) and first-party consumers (`tool-fs`, `tool-str-replace-editor`, `skill-filesystem`, `agent-instructions`, `lsp-stdio`) migrate together. Derived scopes remain linked to the caller signal (`fs-sandbox` re-resolve during containment uses the mutation signal; LSP fuses query and lifetime signals before host I/O). Capability implementations do not synthesize never-abort production sentinels. Callers whose outer protocol still makes cancellation optional own a controller for that call before entering the FS seam.

This is the filesystem family slice of [Required cancellation through tool-reachable capability seams](./2026-07-19-required-cancellation-through-tool-capability-seams.md). Shell and web family slices are also implemented; workflow/subagent/code-runtime remain deferred there.

### Inventory (first-party FS tools → awaited FS calls)

| Tool package | Tools | Awaited `ctx.fs` operations |
|---|---|---|
| `@maple/tool-fs` | `read`, `read_image`, `write`, `edit` | `resolve`, `stat`, `readText`/`streamText`, `readBytes`, `writeText`, `editText` |
| `@maple/tool-str-replace-editor` | `str_replace_editor` | `resolve`, `stat`, `listDir`, `readText`, `writeText` |
| `@maple/tool-fs-search` | `glob`, `grep` | none (subprocess/`rg`, not `ctx.fs`) |

## Alternatives considered

**Keep FS signals optional because tools already receive one.** Rejected: omission remains legal at every optional capability call; TypeScript cannot prove propagation.

**Reorder `writeText`/`editText` to put `signal` before optional `expected`.** Rejected: the seam keeps its existing parameter order; `expected` becomes an explicit `| undefined` slot instead of an optional overload.

**Leave non-tool FS consumers optional.** Rejected: the Service Definition is one seam; splitting optional and required faces would reintroduce omission at shared call sites.

## Consequences

- TypeScript rejects FS calls that omit `signal`; [`signal-types.spec.ts`](../../../../packages/fs/fs/tests/signal-types.spec.ts) pins omission failures.
- Provider and integration suites already prove cancellation reaches side-effect owners (`FS_ABORTED` before creating/rewriting files; tool registry pre-abort classification).
- Pre-release stance: no compatibility overload remains on the migrated seam.
