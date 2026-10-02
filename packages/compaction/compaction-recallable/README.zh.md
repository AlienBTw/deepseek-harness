# @maple/compaction-recallable

[English](README.md) | 中文

面向 Maple Harness 的可回溯压缩后端。将陈旧历史拆成冻结索引存根与一个可变状态检查点，附加确定性回溯页脚，并在总测量上下文无法缩小时拒绝提交。

## 模型体验

- **冻结索引存根** — 新近陈旧的历史按 `chunkTokens` 切块；每块成为短索引卡片（`stubTokens`），之后不再改写，也不再进入后续压缩区域。
- **状态检查点** — 位于全部存根之后的一份可变工作记忆；每轮用上一份状态与本轮陈旧内容重写。
- **布局** — 每次完整通过后请求前缀为 `[stubs…][state][tail]`。提交中途崩溃会留下从左到右的存根前缀；下一轮无条件地补完剩余区域。
- **检查点页脚** — 每个替换均以 `[checkpoint c<seq>: shadows conversation span #<start>–#<end>; originals retrievable via history_read]` 结尾。
- **膨胀保护** — 若替换后估计的总上下文不严格小于替换前，整轮在任何提交前中止（仅在补完未完成轮次时跳过）。
- **回溯配对** — 与 `@maple/tool-recall` 组合，使被遮蔽区段仍可通过 `history_read` 与 `history_search` 访问。

## 配置

在 `BasicCompactionConfig` 之上增加：

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `chunkTokens` | `2048` | 每个冻结索引存根块的目标预算 |
| `stubTokens` | `256` | 单个索引存根的软生成预算（`stubTokens/chunkTokens` ≤ 0.25） |

## 已知限制与后续工作

- 膨胀保护降级阶梯、存根回声检测、预步骤摊销存根起草，以及语义搜索回退，仍是可回溯压缩 Agent Note 中的延期后续项。
- 跨会话回溯仍走 session-query；会话内 `history_search` 使用有界倒排索引，并在挂载 SQLite 时可选走 session-query FTS。
