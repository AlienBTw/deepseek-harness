# @maple/client-ui-agent-team

[English](README.md) | 中文

Agent Teams 任务板表面插件，浏览器半部：在 `conversation.input.dock`（order 20）中通过 `useProjection('agentTeam')` 展示未删除 Team 任务的只读列表。空或缺失 projection 时不渲染。

## Model Experience

无。该 dock 为只读，不追加 session 事件或模型可见输入。

#### KV Cache 影响

无。

## Known Limitations and Deferred Work

- **只读任务板** — 任务变更仍由模型工具与 Remote API 负责；dock 不编辑任务或 roster 行。
