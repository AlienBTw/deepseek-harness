# Agent Note: 让 JSON-RPC 完成结果与传输方向单一化

Status: implemented

[English](2026-07-19-make-jsonrpc-directional.md) | 中文

## 问题

JSON-RPC 桥接层曾把两个端点都建模为对称的对等端，但实际协议具有固定方向。共享传输层（现为 `@maple/sdk-protocol`，由服务端与 TypeScript SDK 客户端共用）曾实现着没有任何端点使用的两个半边：服务端发起的请求与客户端发起的通知。Python SDK 发送请求并接收响应或通知，却还会把来自服务端、但未使用的入站请求放入队列，并公开响应辅助方法。

`session/prompt` 还会用两种协议结构报告同一个已结束轮次。服务端先发出 `session.finished`，再返回常量 `{ accepted: true }`；Python SDK 丢弃该响应，转而等待通知以取得状态。响应只有在处理函数返回后才会写入，因此在同一条有序流上，通知必然先于这个常量响应。

这些未使用的双向能力引入了待处理请求表、生成 ID、请求队列、关闭时的拒绝路径、响应辅助方法和第二套完成等待逻辑，却没有任何生产调用方使用。

## 决策

`session/prompt` 在 `agent.whenIdle()` 之后直接返回 `{ messageId, status, reason }` 作为轮次结果。`status` 为 `ok` | `error` | `aborted`（由捕获的 `TurnEndReason` 按部署映射）；进入空闲却没有 `turn/end` 仍是不变量错误。不再存在 `session.finished` 通知，也不再返回常量 `{ accepted: true }`。`session.event`、`session.status`、`subagent.started` 与 `subagent.finished` 仍可在被等待的处理函数期间、于响应之前流式发出；持久化会话事件仍是最终响应重建的真源。

Python SDK 由 `session_prompt()` 返回经校验的 `SessionPromptResponse`，不再携带 `IncomingRequest`、入站请求队列，或客户端发起通知／响应辅助方法。读取端忽略意外的服务端请求帧，避免它们命中响应等待器。

生产调用点已使用有方向的半边：服务端安装 `onRequest` 并发出 `notify`；TypeScript 与 Python 客户端发出 `request` 并消费入站通知。

## 延期

`JsonRpcLineTransport` 仍是双向对等类（同一类型上同时具备 `request`、`notify`、`onRequest`、`onNotification`）。协议测试仍演练对称传输对。把该类收窄或拆成服务端／客户端传输——使每个端点无法行使未使用方向——仍是本决策未完成的残余工作。

## 备选方案

**为未来方法保留通用的对称 JSON-RPC 对等端。** 服务端发起的请求将来可能用于交互式权限，但当前没有类型化方法或生产消费方。该功能完成设计后，预发布协议可以增加所需的最小方向，无需提前保留未使用的对等端能力。

**为流式客户端保留 `session.finished`。** 轮次结束不是增量数据：请求响应已经标识同一个边界，并且在有序流中位于先前所有通知之后。第二条终止通知会产生两种结果表示，迫使客户端进行协调。

## 后果

- 客户端从 `session/prompt` 响应读取权威的提示词结果；只监听 `session.finished` 的原始客户端必须改读该响应。
- 未来若需要服务端发起请求，应新增类型化协议，而不是复用休眠的对称传输机制。
- 在已结算响应模型下，同一会话的重叠拒绝、分帧、多字节输入、处理器错误、flush、关闭顺序与最终响应重建保持原有行为。
- 在延期的传输收窄落地前，共享类上未使用的对等方法仍可调用，尽管没有任何生产端点使用它们。
