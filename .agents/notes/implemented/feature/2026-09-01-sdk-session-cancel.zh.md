# Agent Note：SDK session/cancel JSON-RPC 方法

Status: implemented

[English](2026-09-01-sdk-session-cancel.md) | 中文

## 问题

进程外 Harness 客户端（TypeScript `@maple/sdk-client`、Python `maple_harness`）可以向会话发送 prompt，但没有在拆毁会话的情况下中止进行中的 turn 的 wire 方法。嵌入方与自动化需要与进程内 `agent.cancel({ kind: 'user' }, { keepInbox? })` 相同的取消语义。

## 决策

在 `@maple/sdk-protocol` 上新增定向 client→server JSON-RPC 请求 `session/cancel` 及 typed params/result，在 `HarnessSdkJsonRpcServer` 中实现，并在 TypeScript SDK 暴露 `client.cancel(sessionId, keepInbox?)`、在 Python SDK 暴露 `client.session_cancel(session_id, keep_inbox)`。

服务端解析 live session 记录，确认 handle 仍拥有当前 agent 实例，再委托 `agent.cancel`。缺失或 stale 的 session 返回 `{ canceled: false }`，不抛错。

## 曾考虑的替代方案

**复用 session/prompt 加 abort 标志。** Prompt 是 turn 启动语义；cancel 是正交生命周期控制，会把两种完成路径混在同一方法上。

**服务端发起的 cancel 通知。** 没有生产消费者被动等待；request/response 保持定向模型并匹配客户端发起的 abort。

## 后果

SDK 客户端可在编程方式停止进行中的工作，并可选保留排队 inbox 消息。该方法与现有 session 生命周期组合；不会 dispose session 或 JSON-RPC 连接。

## 验证

- TypeScript：`packages/sdk/server/tests/server.spec.ts` 覆盖缺失与 live session 上的 cancel；`packages/sdk/client/tests/sdk-client.spec.ts` 覆盖 client 包装。
- Python：`python/sdk/tests/test_client.py::test_client_session_cancel` 覆盖 wire 往返。
