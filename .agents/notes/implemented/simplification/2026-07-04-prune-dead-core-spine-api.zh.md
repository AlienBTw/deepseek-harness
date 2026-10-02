# Agent Note: 裁剪无用的公开与结果接口

Status: implemented

[English](2026-07-04-prune-dead-core-spine-api.md) | 中文

## 问题

若干包根导出、结果字段和便利方法没有生产消费方。它们之所以存活，要么是因为测试通过公开入口导入了内部实现，要么是因为某个类型预期了一个从未出现的调用者。每一项单独看都很小，但合在一起，它们扩大了 SDK 约定、生成的 catalog、文档和回归矩阵，却没有支撑任何已交付的路径。

生产语料库是 `packages/*/*/src`、示例源码/配置和运行时脚本。测试、包 README 和 Agent Note 行文是发布的证据，但不是固定调用者。`cordis_inspect` 使 `packages/extensions/tool-cordis/src/api-catalog.ts` 对模型可见，`cordis_mount` 可以通过受保护的真实服务代理调用注入的服务，因此 catalog 中的服务方法和返回形状是真正的动态产品接口。下表因此区分「没有固定的仓库调用者」与「不可达」：涉及 catalog 词汇的行有意收缩模型编写的 mount 能发现和调用的内容，而包根实现辅助函数并不通过该服务门面可达。

## 决策

本工作收缩了未读结果字段，确认清单中已从包根消失的项，将剩余包根辅助函数降级到内部模块（测试改为深导入），并保留一个生产字段：

- **`CompactionResult`** 不再回显 `startSeq`、`summarySeq`、`endSeq` 或 `summary`。调用方保留 `compactionId`、可选的 `sourceCommandId`、`shadowedRange`、`shadowedSeqs` 与 `shadowedTokenCount`。持久摘要内容与记账事件 seq 只留在会话日志（`compaction/start` / `compaction/summary` / `compaction/end`）。`/compact` 通过定位与 `result.compactionId` 匹配的 `compaction/summary` 推导 `command/done.sourceEventSeq`。basic 与 recallable 的 region 构建器在追加关闭事件后返回收窄后的结果。
- **`LlmError` / `LlmFailure` / `LlmErrorOptions`** 不再携带 HTTP `status`。适配器以稳定的 `code`（以及可选的 `providerRetryAfterMs` / `requestId`）分类；回放与重试不变量不再校验或往返 status。
- **`BlockAssembler.push()`** 已返回 `void`；生产调用方使用 `blocks()` / `message()`。
- **`SurfaceManager.invalidate()`** 与 **`ToolExecutionResult.callId`** 已不存在；调用身份留在 `ToolExecution` 上。
- **`ReactLoopAgent`** 未从 `@maple/agent-loop` 包根再导出；具体类为插件保留在文件内。包外面向 `Agent` 编程，并通过 `ctx.agents` 创建/恢复。
- 已从包根消失的降级项：`workflow-worker-thread` 的 protocol/runtime/session 再导出与命名的 `WorkerThreadWorkflowEngine`；`code-runtime-worker` 的 protocol/bootstrap 再导出；ACP 的 `agentOptions`；`providerWording` / `completedTurnPrefix`；`depthOf` / `SubagentDepthError` / `waitForExit` / `exitsWithin`；持久化 `inits` 访问器、`seedCoversPrefix` 与 `assertSerializable`。
- 已消失的进一步收缩：`compactRegion` 的独立 `session` 参数；`BasicCompactionEngine` 的估算/摘要方法可见性；`CodeLogEntry.source`/`level` 与 `RunCodeMeta.dispatches`；`CodeRuntime.isolation`；`ToolNotFoundError.toolName`、`SystemPrompt.config` 与 `BashTask.command`。
- 已从包根消失的分组辅助导出：下文 assert 之外的 bash/sandbox、fs-local、tool-fs、tool-call-timeout-policy、compaction-basic 的 `resolveConfig`，以及 tool-bash 的 `renderResult`。
- **`CodeRuntime.language`** 予以保留：生产路径上的 `run_code` 与 SDK 渲染按该字段分发。
- 本切片的包根辅助降级：`@maple/llm-deepseek` 与 `@maple/llm-pi-ai` 不再再导出适配器/文件/协议辅助（`DeepSeekAdapter`、file-store/files-api 表面、`PiAiAdapter`、`recordKeyFor`、`supportedProtocols` 及相关常量/类型）；`@maple/bash-local` 不再导出 `assertServiceableBashConfig`；`@maple/web-fetch-http` 与 `@maple/web-search-*` 不再再导出 provider 类、provider id 与默认常量；`@maple/tool-web` 不再再导出 `present*` / `*Meta*` 辅助。这些符号仍留在各自模块中；测试改为深导入。

## 延期

无。原提案清单已全部落入上方决策、予以保留（`CodeRuntime.language`），或在本切片中从包根降级。

## 曾考虑的替代方案

**保留测试便利函数和自包含的结果字段为公开。** 公开辅助函数可以让白盒测试更方便，自包含的结果字段看起来更易用，未来的嵌入者可能需要具体循环类或枚举方法。这些好处是假设性的；当前它们让每处实现和文档都要解释没有已交付调用者能观察到的状态。真正的消费方可以引入它所需的最小约定，其所有权和失败语义明确。

**保留所有 catalog 成员以供模型编写的 mount 使用。** 自引用工具集是一条真实的通用消费路径，而非生成文档的噪音。然而，它的价值来自准确、可组合的服务接口，而非无限期保留重复字段或不一致的参数对；每一项 catalog 收缩都移除了在同一次执行、同一个 agent（智能体）或同一结果中其他位置已可获得的事实，并在同一变更中更新 API 参考。

**在一次变更中完成全部清单。** 辅助导出列表跨越许多包与测试入口。先落地未读结果字段，可使 catalog 与文档表面诚实，同时不阻塞后续降级；那些降级已在本切片完成。

**降级 `CodeRuntime.language`。** 已否决：`run_code` 与 tools SDK 渲染器按所挂载运行时的 language 字段分发；移除它会破坏多语言 Code Mode，而不是删除无用表面。

## 后果

- 压缩调用方与 `/compact` 呈现必须从会话日志（或结果上的遮蔽计量）读取摘要内容与事件 seq，而不能依赖结果回显字段。
- LLM 失败 payload 不再宣传原始 HTTP status；路由仍基于 `code` / 消息分类。
- 外部预发布嵌入者与模型编写的 mount 在生成 catalog 中会看到更窄的 `CompactionResult` 与 `LlmFailure`。
- 需要降级辅助的白盒测试改为导入 `@maple/<pkg>/src/<module>.ts`，而非包根；包根保留 Cordis 插件约定（`name` / `inject` / `Config` / `apply` 或默认服务类）。
