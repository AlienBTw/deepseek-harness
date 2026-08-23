# Agent Note：本地 Ollama 提供商与服务器声明的能力

Status: implemented

[English](2026-08-22-local-ollama-provider-and-real-capabilities.md) | 中文

## Problem

本地模型服务过去只能手工声明每个模型：id、容量与线上协议都得敲进 settings，而且一旦拉取或删除了模型就立刻过期。改成硬编码默认容量数字则是编造事实——Ollama 的实际上下文取决于拉取了哪个变体以及它如何被服务，任何常量都必然对某些人是错的。

## Decision

`@deepseek-ai/dsh-llm-pi-ai` 把 `ollama` 注册为一个 catalog 提供商，带三个仅含标识的引导条目（`llama3.2`、`qwen2.5-coder`、`deepseek-r1`），以 `openai-completions` 指向 `http://127.0.0.1:11434/v1`。这些条目不携带上下文窗口或输出上限：路由物化会填入其可配置默认值，因此不会出厂任何编造的数字。

模型发现对 `ollama` 做三处特殊处理：

- 它豁免于 catalog 捷径，因为它实际服务的模型取决于本机拉取了什么。
- 询问先探测 OpenAI 形状的 `GET /models`，再探测原生的 `GET /api/tags`；原生形状只在提供方为 `ollama` 时请求，因此通用网关绝不会收到携带其凭据的兄弟路径请求。
- `/api/tags` 披露标识却不含容量事实，因此每个发现的 id 会通过 `POST /api/show` 直接追问：回复里以架构名为前缀的 `*.context_length` 值成为该模型的上下文窗口。show 调用失败时静默降级——列表存活，该模型保持无容量状态。

## Alternatives considered

**为什么不发布修正过的静态默认值？** 任何数字都对某些拉取是错的：同一模型不同标签各异，且服务器可以把模型服务在远低于其训练上限的水平。静态值还会在发现本可以正确的时候过期。

**为什么不从 `/api/show` 的 parameters 字符串解析 `num_ctx`？** 该字段只列出非默认覆盖项，缺席无法与「默认值未知」区分，而默认值本身又随服务器版本变化。架构名前缀的 context length 才是那一条被明确声明的事实。

**为什么不在 Tauri 侧或 UI 侧另写一个 Ollama 客户端？** 发现属于拥有提供方词汇的适配器；第二个客户端会把凭据处理和错误码拆散到多个表面。

## Consequences

未配置的 ollama 路由可以解析并服务，但在发现运行之前，它的引导条目按路由默认值取大小，而非真实值。每次 fetch 动作会对每个发现的模型付出一次 `POST /api/show`——纯本地流量、顺序执行、受列表约束。这条负面保证是有意的：运行中的服务器没有声明过的 Ollama 容量，本包绝不代为声明。

