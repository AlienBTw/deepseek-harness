# @maple/client-ui-task-surface

[English](README.md) | 中文

Task Surface 界面插件（浏览器端部分）：`TaskSurfaceDock` 是 `conversation.input.dock` composer 上下文堆栈中的可操作卡片（order 30，位于 Queue 之后）；`TaskSurfaceRow` 是 `show_task_surface` 在 `tool.call.toolview` 上的带 key transcript 行。活跃关联经 `useProjection('taskSurface')` 到达；注入面经 `ctx.remote.taskSurface.getActive` 加载权威模型，经 `submit` 提交，经 `dismiss` 关闭。无活跃 Surface 时 dock 不渲染。

dock 渲染声明式 `TaskSurfaceModelV1` 的 sections（markdown、metric、diff、table）与 fields（choice、text、order）。条件字段、上传与客户端拉取不在 v1 范围内。

`/client` 导出插件主体（`apply`/`inject`）及注入动词面类型。

## Model Experience

间接地，通过 `taskSurface/submit`：被接受的提交会排队一条普通可见用户消息并启动下一轮。关闭会追加 `task-surface/dismissed` 且不产生 prompt。dock 本身不添加 prompt 内容。

#### KV Cache effect

除非排队的用户消息在后续模型请求中被接纳，否则无影响；dock 不直接改变缓存。

## Known Limitations and Deferred Work

- **条件字段 / 上传 / 客户端拉取** — 留待后续协议升级；v1 仅保留封闭的声明式词汇。
