# @maple/compaction-recallable

[English](README.md) | 中文

面向 Maple Harness 的可回溯压缩后端。在基础压缩策略之上增加确定性检查点页脚，引导模型使用 `history_read`，并通过膨胀保护在总上下文无法缩小时拒绝提交。

## 模型体验

- **检查点页脚** — 每个替换检查点都以 `[checkpoint c<seq>: shadows conversation span #<start>–#<end>; originals retrievable via history_read]` 结尾。
- **膨胀保护** — 若替换后估计的总上下文不严格小于替换前，压缩尝试会在提交前中止。
- **回溯配对** — 与 `@maple/tool-recall` 组合，使被遮蔽区段仍可通过 `history_read` 与 `history_search` 访问。

## 配置

使用与 `@maple/compaction-basic` 相同的 `BasicCompactionConfig` 配置面。

## 已知限制与后续工作

- 可回溯压缩设计中的索引存根、冻结多检查点布局与状态检查点重写仍属后续范围；本包先交付带回溯页脚与膨胀保护的基础单检查点路径。
