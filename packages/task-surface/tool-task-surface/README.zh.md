# @maple/tool-task-surface

[English](README.md) | 中文

面向模型的 `show_task_surface` 工具，用于展示交互式 UI 面板并结束当前轮次以等待用户提交。

## 模型体验

### 工具模式

#### 模型可见内容

模型看到生成的 [`show_task_surface` 工具模式](../../../docs/tool-catalog.zh.md#mapletool-task-surface)。

#### Token 影响

在工具可见的每个请求中产生固定的模式成本。

#### KV 缓存影响

在定义和可见性未变更时保持前缀稳定。插件生命周期或作用域限制可能会使来自此模式的重用失效。

### 工具调用历史与结果

#### 模型可见内容

每个助手工具调用在其参数中保留声明式的 TaskSurfaceModelV1。工具结束轮次，发出用于 UI 渲染的展示元数据，并返回包含唯一 surface ID 和标题的确认信息。

#### Token 影响

工具参数中的声明式 JSON 结构会向消息轮次贡献 token。

#### KV 缓存影响

线性追加到轮次转录中，不会导致前缀失效。

## 已知限制与后续工作

- 目前需要支持任务表面渲染的前端客户端。
