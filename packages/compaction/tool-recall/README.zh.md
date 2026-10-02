# @maple/tool-recall

[English](README.md) | 中文

面向模型的 `history_read` 与 `history_search` 历史回溯工具。允许智能体检索已被压缩的历史对话跨度，确保关键上下文永远可追溯。

## 模型体验

### 工具模式

#### 模型可见内容

模型看到生成的 [`history_read` 与 `history_search` 工具模式](../../../docs/tool-catalog.zh.md#mapletool-recall)。

#### Token 影响

在工具可见的每个请求中产生固定的模式成本。

#### KV 缓存影响

在定义和可见性未变更时保持前缀稳定。插件生命周期或作用域限制可能会使来自这些模式的重用失效。

### 工具调用历史与结果

#### 模型可见内容

每个助手工具调用在其参数中保留请求的参数。`history_read` 返回带有序列号和行边界的分页遮蔽跨度；`history_search` 返回带有检查点 ID、序列号和覆盖元数据（`scanned`／`matched`／`truncated`／`mode`）的匹配片段。搜索对遮蔽转写使用有界内存倒排索引，并在挂载 `sessionQuery` 时可选通过 FTS 加速候选。

#### Token 影响

工具调用参数和返回的转录片段在被压缩之前会向历史末尾增加 token。

#### KV 缓存影响

线性追加到轮次转录中，不会导致前缀失效。

## 已知限制与后续工作

- 检索目前基于内存会话日志的字面量扫描。
