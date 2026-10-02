# Agent Note: Required cancellation on the web capability seam

Status: implemented

English | [中文](2026-07-19-required-cancellation-on-web-capability-seam.zh.md)

## Problem

The [tool registry cancellation contract](./2026-07-19-cooperative-tool-cancellation.md) requires `exec.signal` in every tool body, and [`WebSearchProvider` / `WebFetchProvider`](../../../../packages/web/web/src/types.ts) already documented a required `AbortSignal`, but `WebRuntime.search` / `fetch` still accepted an optional signal. A web tool could therefore type-check while dropping cancellation before the selected provider owned the live network request.

## Decision

`WebRuntime.search(request, signal)` and `WebRuntime.fetch(request, signal)` require a caller-owned `AbortSignal`. Every search/fetch provider (`web-search-exa`, `web-search-perplexity`, `web-search-deepseek`, `web-fetch-http`) and the `dsh-tool-web` consumer forward that signal; no provider synthesizes a never-abort sentinel. Compile-time omission is pinned by [`signal-types.spec.ts`](../../../../packages/web/web/tests/signal-types.spec.ts).

This is the web family slice of [Required cancellation through tool-reachable capability seams](./2026-07-19-required-cancellation-through-tool-capability-seams.md).

## Alternatives considered

**Keep Service Definition signals optional because providers already require them.** Rejected: callers invoke `ctx.web`, not providers directly; an optional seam face reintroduces omission at the only public entry point.

**Synthesize `new AbortController().signal` inside the seam when omitted.** Rejected: hides dropped caller cancellation and violates the no-sentinel rule on migrated seams.

## Consequences

- TypeScript rejects web `search`/`fetch` calls that omit `signal`.
- Provider and tool suites prove abort reaches the network owner (`WEB_ABORTED`, tool-forwarded `exec.signal`).
- Pre-release stance: no compatibility overload remains on the migrated seam.
