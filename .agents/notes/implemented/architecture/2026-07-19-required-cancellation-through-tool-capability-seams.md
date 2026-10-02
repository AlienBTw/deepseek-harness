# Agent Note: Required cancellation through tool-reachable capability seams

Status: implemented

English | [中文](2026-07-19-required-cancellation-through-tool-capability-seams.zh.md)

## Problem

The implemented [tool registry cancellation contract](./2026-07-19-cooperative-tool-cancellation.md) makes `exec.signal` required in every tool body, but many asynchronous capability interfaces reached from those bodies still accept an optional signal. A tool can therefore satisfy its own type while accidentally dropping cancellation at the next same-process call.

That gap is transitive. A filesystem tool may call path resolution and I/O, a web tool may call a provider, a bash tool may call an executor, and a composite tool may start or wait for tasks, subagents, or workflows. If any awaited operation controlling tool-owned work accepts omission, TypeScript cannot prove that cancellation remains available at the boundary that owns the side effect.

Requiring signals on every asynchronous function in the repository would overreach. Some operations are not reachable from tools, some synchronous queries cannot wait or own ongoing work, and explicitly detached work has a new owner after a deliberate handoff.

## Decision

Require an `AbortSignal` on every asynchronous same-process capability operation that is reachable from a tool body while the tool still owns or awaits the operation. The requirement may be a positional parameter or a required readonly request field according to the owning seam's existing shape, but omission must fail TypeScript compilation.

Each direct caller supplies a signal it owns or propagates from its own required operation context. Implementations may derive a child deadline or cancellation scope, but the derived signal remains linked to the upstream signal for the delegated lifetime. Capability implementations do not synthesize never-abort signals, use ambient async-local cancellation, or validate `AbortSignal` at runtime solely to repeat the typed same-process contract.

### Shipped families

| Family | Note |
| --- | --- |
| Filesystem | [Required cancellation on the filesystem capability seam](./2026-07-19-required-cancellation-on-filesystem-capability-seam.md) |
| Shell / bash / pwsh | Required `signal` on `ShellExecRequest` / `ShellExecSpec`; compile-time omission in `packages/shell/shell/tests/signal-types.spec.ts` |
| Web search / fetch | [Required cancellation on the web capability seam](./2026-07-19-required-cancellation-on-web-capability-seam.md) |

### Deferred families

Workflow, subagent, code-runtime, jobs/task waits, and similar tool-reachable seams still migrate by coherent Service Definition / Provider / Consumer PR when inventoried. Scope boundary below still applies.

### Scope boundary

The decision includes asynchronous capability operations whose completion or cancellation remains part of the invoking tool's lifetime, including start operations before ownership transfer, foreground execution, reads and writes, provider requests, waits, and cleanup or disposal that the tool awaits.

The decision excludes synchronous registry lookup, availability checks, schema rendering, argument classification, and other operations that cannot retain asynchronous work. It also excludes work after an explicit detached-ownership handoff: once a task, workflow, worker, or child agent has been successfully published to a new lifecycle owner, that owner's controller governs the detached lifetime. The initiating start operation still requires the caller signal until the handoff commits, and any later tool call that waits for detached work requires its own invocation signal.

Optional cancellation may remain on parser, config, model/tool JSON, durable/file format, worker, process, or wire inputs when the external protocol makes it optional. The owning boundary must resolve that input into a required same-process signal before calling a migrated capability seam.

## Alternatives considered

**Leave downstream signals optional because tool bodies now receive one.** Rejected because availability at the outer callback does not make propagation type-safe; omission remains legal at every optional capability call.

**Enforce propagation with lint rules or callback inspection.** Rejected because syntax checks cannot reliably identify ownership, derived signals, abstraction layers, or correct quiescent settlement. Required interface parameters express the contract where TypeScript can check every caller.

**Pass `ToolRunContext` through every capability.** Rejected because capabilities need cancellation, not tool identity, agent state, or context deferral. Passing the larger context couples reusable services to the tool registry and obscures the narrow seam.

**Use an ambient async-local signal.** Rejected because hidden propagation makes ownership and detached handoff difficult to audit, complicates tests, and lets calls silently bind to the wrong lifetime.

**Add default or never-abort signals at capability implementations.** Rejected because defaults erase the missing owner instead of exposing it at compile time.

**Migrate every capability in the implemented tool-registry change.** Rejected because the transitive interface changes span independent capability families. Keeping this decision separate preserves the implemented registry decision and lets each deep seam migrate with focused tests.

## Consequences

- FS, shell, and web tool-reachable awaits require `AbortSignal` with compile-time omission tests.
- Remaining families migrate without optional compatibility overloads under the pre-release stance.
- Integration tests at process, worker, socket, provider, and task boundaries remain necessary to prove observation and quiescence, not only type availability.
