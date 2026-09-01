# Agent Note：将 Agent Teams 提升为产品包

Status: implemented

[English](2026-09-01-agent-teams-promotion.md) | 中文

## 问题

Agent Teams 的服务与工具契约、REAL-composition 覆盖与浏览器任务板表面已经就绪，但仍位于 `packages/experimental/` 并使用 `@maple/experimental-*` 名称。该放置方式把包排除在发布族之外，却迫使每个消费者通过 examples 或定制 patch 显式挂载，并阻止随产品发布的 maple-base 与 standard preset 一并挂载 host 服务、scoped 工具与 Web UI。

## 决策

将领域提升到 `packages/agent-team/`，命名为 `@maple/agent-team` 与 `@maple/tool-agent-team`；新增 `@maple/client-ui-agent-team`，在新的 `agentTeam` session projection 上提供只读任务板 dock；并把三者接入 maple-base、maple-web-app 与 `standard` agent preset。不提供兼容别名：import、Cordis 行、目录与工作区路径仅使用提升后的名称。

`@maple/agent-team` 在组合 `sessionProjections` 时注册 `agentTeam` projection 单元。fold 按数字创建顺序保留未删除的 `team/task` 快照；已删除任务从 wire 视图中移除。`@maple/client-ui-agent-team` 在 `conversation.input.dock` 渲染该 projection，不添加 Remote 变更。

maple-base 在 host 平面挂载 `@maple/agent-team`。`standard` preset 在其 delegation 组挂载 `@maple/tool-agent-team`。maple-web-app 挂载 `@maple/client-ui-agent-team`。重复 scoped 工具注册仍在安装时失败；Team 作用域内不会静默回退到旧 continuable 控制工具。

## 备选方案

**保持 experimental 放置并仅文档化 profile patch。** 否决：[experimental Agent Teams 包决策](../architecture/2026-08-18-experimental-agent-teams-packages.zh.md) 已把 promotion 定为出口，产品现在需要每个随附 host 组合都挂载该服务。

**在旧 npm 名称下添加兼容重导出。** 否决：预发布策略偏好正确基础而非别名垫片。

**仅通过新 Remote 命名空间暴露任务板状态。** 对首次 promotion 否决：session 日志已携带 `team/task` 快照，projection fold 即可给浏览器同一权威读模型，无需另一条 RPC 表面。

## 后果

Agent Teams 加入 dsh 发布族与标准工作区图。examples、生成目录与子系统文档指向 `packages/agent-team/*`。这些包不再受 experimental 依赖隔离约束；正式发布包可正常依赖它们。

experimental 目录仅保留无关原型。后续可在需要 Remote 或 projection 契约时再扩展 roster 行或 host 侧变更。

## 验证

- `packages/agent-team/agent-team/tests/loader-composition.spec.ts` 经 Loader 启动 `@maple/agent-team` 与 `@maple/tool-agent-team`，并断言 `ctx.agentTeams` 与 `team_task_create`。
- `packages/agent-team/agent-team/tests/projection.spec.ts` 将 `team/task` 创建/更新/删除 fold 进 `agentTeam` projection。
- `packages/client/ui-agent-team/tests/browser-plugin.client.spec.tsx` 从 `useProjection('agentTeam')` 渲染任务，并在空板时隐藏。
