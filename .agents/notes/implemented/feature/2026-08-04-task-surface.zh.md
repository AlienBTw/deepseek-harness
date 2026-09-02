# Agent Note：用于结构化会话交互的 Task Surface

Status: implemented

[English](2026-08-04-task-surface.md) | 中文

## 问题

有些任务需要一次结构化交互——比较选项、审阅表格或填写相关字段——而不是来回发散文消息。若没有有界契约，agent 要么交付产品专用面板，要么生成可执行的 Client Plugin 代码，二者都放错了所有权与生命周期成本。

## 决策

将 **Task Surface** 作为由静态 Web 客户端插件渲染、带版本的声明式模型（`TaskSurfaceModelV1`）交付。面向模型提供一个工具 `show_task_surface` 来发布面板、结束当前轮次并等待经 Host 校验的提交。持久化产物是用户提交的结论，以一条普通的可见用户消息出现，而不是面板外壳。

包划分：

| 包 | 职责 |
|---|---|
| `@maple/task-surface` | 解析器、限制、投影折叠、`task-surface/dismissed` 以及 Host `taskSurface` 服务（`getActive`、`submit`、`dismiss`） |
| `@maple/tool-task-surface` | 带呈现元数据与 `concludeTurn()` 的 `show_task_surface` |
| `@maple/client-ui-task-surface` | `conversation.input.dock` Task Surface 面板与经 Remote 转发的提交面 |
| `@maple/host/apiproxy` | `taskSurface.getActive`、`taskSurface.submit`、`taskSurface.dismiss` RPC |

`maple-base` 挂载 `@maple/task-surface`；`standard` 预设挂载 `@maple/tool-task-surface`；`maple-web-app` 挂载 `@maple/client-ui-task-surface`。每个会话最多一个打开的 Surface；重复打开、嵌套调用以及提交仍处理中时均失败并报错。

## 已考虑的替代方案

**按任务形状增加产品专用触发器。** 已拒绝：一套准入组件词汇表加显式 `show_task_surface` 调用可在不耦合发布节奏的情况下扩展。

**在工具载荷中生成 HTML/JS。** 已拒绝：那是没有插件生命周期的 Client Plugin 权限。

**用 `ask_user_question` 承载大型表单。** 已拒绝：ask 在轮次中途阻塞；Task Surface 结束轮次，可在刷新后保持打开，直到提交或关闭。

## 后果

结构化 UI 可通过 `tool/result` 上的 `presentationMeta` 与 `taskSurface` 投影回放。队列限制与品牌关联 id 在 apiproxy 接缝处生效。v1 不含条件字段、上传与客户端拉取；新块种类属于协议变更，需同步解析器、渲染器与快照覆盖。

## 验证

- `packages/task-surface/task-surface/tests/` — 解析器、投影、服务提交/关闭、loader 组合。
- `packages/task-surface/tool-task-surface/tests/` — 工具注册与不变量伴随项。
- `packages/client/ui-task-surface/tests/browser-plugin.client.spec.tsx` — 停靠区注册与 Remote 动词转发。
- `apps/web/tests/task-surface.e2e.ts` — 无密钥种子组合在已记录的 `show_task_surface` 结果上展示停靠区。
