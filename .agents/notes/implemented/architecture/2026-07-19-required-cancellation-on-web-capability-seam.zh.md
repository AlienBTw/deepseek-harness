# Agent Note: Web 能力 seam 上的必填取消

Status: implemented

[English](2026-07-19-required-cancellation-on-web-capability-seam.md) | 中文

## 问题

[工具注册表取消约定](./2026-07-19-cooperative-tool-cancellation.zh.md)要求每个工具体都有 `exec.signal`，且 [`WebSearchProvider` / `WebFetchProvider`](../../../../packages/web/web/src/types.ts) 已将 `AbortSignal` 文档化为必填，但 `WebRuntime.search` / `fetch` 仍接受可选 signal。因此 web 工具可以在类型检查通过的同时，在所选提供方持有实际网络请求之前丢掉取消。

## 决策

`WebRuntime.search(request, signal)` 与 `WebRuntime.fetch(request, signal)` 要求调用方持有的 `AbortSignal`。每个 search/fetch 提供方（`web-search-exa`、`web-search-perplexity`、`web-search-deepseek`、`web-fetch-http`）以及 `dsh-tool-web` 消费方转发该 signal；任何提供方都不得合成永不中止的哨兵。[`signal-types.spec.ts`](../../../../packages/web/web/tests/signal-types.spec.ts) 钉住编译期省略失败。

这是[工具可达能力 seam 上的必填取消](./2026-07-19-required-cancellation-through-tool-capability-seams.zh.md)的 web 族切片。

## 考虑过的替代方案

**因提供方已要求 signal 而让 Service Definition 保持可选。** 否决：调用方走 `ctx.web` 而非直接调提供方；可选 seam 面会在唯一公开入口重新引入省略。

**在省略时于 seam 内合成 `new AbortController().signal`。** 否决：掩盖调用方取消丢失，并违反已迁移 seam 的无哨兵规则。

## 后果

- TypeScript 拒绝省略 `signal` 的 web `search`/`fetch` 调用。
- 提供方与工具套件证明中止到达网络所有者（`WEB_ABORTED`、工具转发的 `exec.signal`）。
- 预发布立场：已迁移 seam 不保留兼容重载。
