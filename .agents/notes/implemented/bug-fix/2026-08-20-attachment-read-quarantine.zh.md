# Agent Note: 隔离无法读取的历史附件

Status: implemented

[English](2026-08-20-attachment-read-quarantine.md) | 中文

## 问题

已接纳的 `ImageAttachmentRef` 会留在持久历史中，因此在被压缩替换前都会参与之后的每次请求。引用对象丢失、完整性校验失败或无法读取时，`AttachmentStore.readImage()` 会返回 `ATTACHMENT_NOT_FOUND`、`ATTACHMENT_CORRUPT` 或 `ATTACHMENT_READ_FAILED`。未变化的历史随后会让之后每次模型请求在同一对象上失败，使会话无法继续，即使其余消息仍可使用。这是[可重建请求](../../implemented/architecture/2026-07-05-reconstructable-requests.zh.md)保留为明确失败的对象不可用情况。

## 决策

`@maple/attachment` 中的共享请求投影消费方从会话日志折叠隔离状态，并在分派给提供方之前准备请求图片。`ATTACHMENT_NOT_FOUND` 和 `ATTACHMENT_CORRUPT` 立即追加 `attachment/quarantine`；`ATTACHMENT_READ_FAILED` 先执行一次服从取消信号的读取重试，重试仍失败时以可重试原因追加同一事件。取消和未分类失败不会隔离数据。

已隔离引用在模型请求中投影为确定性占位文本。通过 `recoverQuarantinedAttachment` 恢复时，经 `readImage()` 校验字节后追加 `attachment/recovered`。会话事件类型合并到 `@maple/session` 的 `SessionEventMap`（attachment 包若引用 session 会与 `@maple/llm` 形成 TypeScript 项目循环）。DeepSeek 与 Pi 适配器通过 `ctx.get('sessions')?.get(sessionId)` 调用共享消费方以记录实时隔离。

## 考虑过的替代方案

- **让每次请求继续失败。** 这保留了严格错误报告，但一次存储故障会让其他部分仍可使用的持久会话永久不可用。
- **删除或重写历史图片块。** 这会丢失证据、违反仅追加历史，并使修复后的内容寻址对象无法恢复原始请求。
- **由每个适配器分别捕获错误。** 未记录的占位会让回放取决于当时存在的适配器和存储状态，重复策略也会发生偏差。
- **自动替换丢失或损坏的字节。** 引用标识经过验证的不可变内容；在该身份下替换成其他字节会破坏完整性校验。

## 后果

无法读取的历史图片不再阻断后续轮次。隔离与恢复通过持久事件和占位文本对模型可见。没有活跃会话的适配器对无法读取的引用仍会明确失败，而不是静默跳过隔离记录。

## 验证

- `packages/attachment/attachment/tests/request-projection.spec.ts` 覆盖分类、幂等隔离、重试、恢复和嵌套工具结果图片。
- `packages/llm/llm-deepseek/tests/adapter.spec.ts` 覆盖带活跃会话的隔离占位。
- 恢复通过 apiproxy `session.attachment` 的 `recover: true` 暴露。

## 风险

隔离和恢复各会改变一次提供方前缀。实现必须在记录状态前识别准确的失败引用，并协调并发请求，使重复失败只产生一次有效转换。没有活跃会话的辅助调用无法记录恢复状态；它们的失败策略属于明确的实现范围，不能退回到适配器自行处理。
