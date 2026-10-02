# Agent Note: 会话保留、GC 与分页列表

Status: implemented

[English](2026-09-28-session-retention-gc-paginated-list.md) | 中文

## 问题

会话持久化只能列出全部 header，且没有删除或保留面。Web 重连会拉取无界的 `session.list`，并对每个已存会话跑冷 blank 探测。部署需要 `delete(id)`、由 Config 驱动的 GC（`maxAgeDays`、`maxSessions`），以及分页列表线路，使冷路径只汇总一页。

## 决策

`SessionPersistence` 增加 `delete(id)`、`listPage({ cursor, limit })` 与 `gc()`。`retention.ts` 中的共享助手负责最新优先的 keyset 分页与回收对象选择（先按年龄，再按数量）。JSONL 与 SQLite 的 Config 接受可选的 `maxAgeDays`／`maxSessions`；`gc` 会跳过仍挂接的 live 会话。删除在仍有 live Session 挂接时拒绝，并把缺席视为成功。

ApiProxy 的 `session.list` 接受可选 `limit`（默认 50，最大 200）并返回 `nextCursor`。它会对已挂接摘要与冷 header 做 keyset 分页，然后只对选中的冷页做 blank 探测。Web `SessionManager.refreshList` 会遍历各页直到耗尽，使客户端快照保持完整，同时每次 Host 往返保持有界。

## 考虑过的替代方案

**把 `list()` 改成始终返回一页。** 被拒绝：会静默打断每个期望完整 header 向量的同进程调用方；`listPage` 是增量 API，`list` 仍是完整元数据扫描。

**偏移游标。** 被拒绝：页间插入会导致重复或跳过；keyset `(activityAt, id)` 在仅追加存储下保持稳定。

**每次 list 自动 GC。** 被拒绝：list 是观察路径；GC 保持为运营商或启动钩子可显式调度的入口。

## 后果

持久化测试覆盖分页与回收对象选择；后端实现耐久删除。搜索仍构建完整可见集合，因为排序需要授权全集。SQLite 日后可不加载每个 header 即寻址；JSONL 列目录时仍扫描 header 行。
