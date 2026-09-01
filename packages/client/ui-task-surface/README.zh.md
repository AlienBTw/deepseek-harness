# @maple/client-ui-task-surface

[English](README.md) | 中文

Task Surface 界面插件（浏览器端部分）：`TaskSurfaceDock` 是 `conversation.input.dock` composer 上下文堆栈中的可操作卡片（order 30，位于 Queue 之后）。活跃关联经 `useProjection('taskSurface')` 到达；注入面经 `ctx.remote.taskSurface.getActive` 加载权威模型，并经 `ctx.remote.taskSurface.submit` 提交。无活跃 Surface 时 dock 不渲染。

`/client` 导出插件主体（`apply`/`inject`）及注入动词面类型。

## Model Experience

间接地，通过 `taskSurface/submit`：被接受的提交会排队一条普通可见用户消息并启动下一轮。dock 本身不添加 prompt 内容。

#### KV Cache effect

除非排队的用户消息在后续模型请求中被接纳，否则无影响；dock 不直接改变缓存。

## Known Limitations and Deferred Work

- **M1.3 最小面板** — dock 仅显示活跃标题与一个提交控件；声明式字段、关闭操作与带 key 的 transcript 行留待后续。
