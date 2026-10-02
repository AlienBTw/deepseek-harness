# Agent Note: 在会话索引中记录最后活动

Status: implemented

[English](2026-07-29-durable-last-activity-index.md) | 中文

## 问题

冷会话（已持久化、未附加）对「用户上次是什么时候在这里发出 prompt」没有权威的已存储答案。`dsh-host-apiproxy` 曾从可选 projection cache 的 `lastPromptAt` 提供 `updatedAt`，缺失时回退到 `createdAt`，Web 客户端按该值为 Session 树排序。cache 采用 fail-soft 并异步写入 checkpoint，因此缺失或延迟的记录会让最近收到 prompt 的 Session 排得过旧。

网关以前会在可用时采用 JSONL 产物的 mtime。mtime 回答的是另一件事：这份产物上次是什么时候被写入。每一次持久写入都会刷新它，包括对撕裂尾部的截断修复、平衡中断轮次的合成 closer，以及拾起时追加的 [`session/end-seed` 边界](./2026-07-30-session-end-seed-log-boundary.zh.md)。这套近似会让 Session 仅仅因为被打开就提升排序。[有界冷空白验证](../bug-fix/2026-08-13-bounded-cold-blank-verification.zh.md)移除了 mtime 排序，并把 cache 保守的「过旧」错误方向作为现阶段取舍。

已附加摘要可以折叠实时事件日志并选择最新的真人 `user/message`，但冷路径有意不读取大日志。为计算 `updatedAt` 而读取每一份日志，会让 `list()` 的开销随对话总字节数而非 Session 数量增长。

## 决策

把最新真人 prompt 时间存到 Session 索引，这样 `summarizeCold()` 无需打开日志或依赖 cache checkpoint 就能给出答案。协调器用共享谓词折叠每一次追加批次，并把更新后的值放在 `SessionHeader.lastPromptAt` 上交给后端持久化。

共享规则是 `@maple/session-persistence` 中导出的同一个 reducer/谓词：`source.kind` 为 `user` 的 `user/message`。已附加 Session 列表 metadata 与两个后端都使用该定义，避免新的消息来源变体让已附加排序与冷排序发生分歧。

该字段引入之前的产物没有这个值。列举把缺失当作 `createdAt`（诚实；不用 mtime）。既有选择器与会话树会在升级时按创建时间重排一次，直到各会话在本构建下再次收到真人 prompt。

两个已交付后端以不对称方式持久化该索引：

- **SQLite** 在 `sessions` 上存储 `last_prompt_at`，与 `appendBatch` 写在同一事务中，并把 `SCHEMA_VERSION` 单调递增到 18。旧磁盘版本在打开时被拒绝。
- **JSONL** 无法改写不可变的 header 行。每次成功追加批次后，它原子发布每会话的 `session.activity` 伴随文件（`seq` + `lastPromptAt`）。`list()` 在不打开日志的情况下把伴随文件合并进返回的 header。`open`/`loadStored` 会把伴随文件与日志 tip 对齐（`seq` 不一致或文件缺失时重写），否则回退到折叠日志 / `createdAt`。

冷路径的 `SessionSummary.updatedAt` 先读持久化索引，再在可用时使用精确的小工件探测折叠，最后才是 `createdAt`。projection-cache 的最近时间提示不再用于冷路径 `updatedAt`；cache 行仍用于空白状态。

## 考虑过的替代方案

**在冷路径上读取日志。** 它按构造就是正确的，也不需要改动格式，但会让只读 header 的列举失去意义：`list()` 的开销将随日志总体量增长，而 web 会话树会扇出到存储中的每一个会话。mtime 近似的存在，正是为了避开这个选项。

**保留 mtime，但把边界的写入排除在它之外。** 否决的理由是做不到，而不是不合意：mtime 属于文件系统，不属于后端。除了在每次边界写入之后把时间戳复原，没有别的办法能保住它，而那样做会与任何并发读取方产生竞态，也会对这份产物撒谎。

**仅在确实发生了修复时才写入边界。** 这能降低出现频率，而[边界 Agent Note](./2026-07-30-session-end-seed-log-boundary.zh.md)已经否决过它：谓词对有序重启同样必须成立。用一条正确性不变式去换时间戳的准确度，方向是错的。

**从投影缓存派生活动时间。** 这是当时的过渡实现。`session-projection-cache` 会折叠水位线之后的尾部，无需改变持久格式，但它是可选且 fail-soft 的。缺失或 checkpoint 延迟会让排序取决于 cache 是否存在以及是否新鲜，因此无法提供权威值。

**可变的 JSONL header 字段。** 否决：header 就是第 1 行，在物化时一次写就；已提交字节绝不重写。每次追加都改 header 会违反该持久性不变式。

## 后果

在本索引下写入的会话，冷列举最近时间可以在不打开大日志的情况下保持精确。已附加排序与冷排序共享同一个谓词。字段引入之前的日志能够无错误地列举，并在再次收到 prompt 之前按 `createdAt` 排序。JSONL 追加与伴随文件写入之间的崩溃，会在下一次 open 对齐伴随文件之前留下陈旧的列举值——对该窄窗口保持与原先 cache 回退相同的保守「过旧」方向。schema 17 及更早的 SQLite 数据库在打开时会明确失败。

## 相关

- [有界冷空白验证](../bug-fix/2026-08-13-bounded-cold-blank-verification.zh.md)——移除 mtime 排序，并把直接冷读取限制为小产物 metadata 验证。
- [种子结束日志边界](./2026-07-30-session-end-seed-log-boundary.zh.md)——让 mtime 不适用的非 prompt 写入之一。
- [会话持久化](./2026-06-14-session-persistence.zh.md)——仅追加与绝不重写这两条不变式，正是它们排除了可变的 JSONL header 字段。
- [共享持久化写入协调器](./2026-06-18-shared-persistence-write-coordinator.zh.md)——计算并转发 `lastPromptAt` 的追加路径。
