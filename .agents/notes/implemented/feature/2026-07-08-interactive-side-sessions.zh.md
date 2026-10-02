# Agent Note: 交互式侧会话与合并回写

Status: implemented

[English](2026-07-08-interactive-side-sessions.md) | 中文

## 问题

用户可能希望在不改变当前会话主上下文的前提下，探索一个来自活跃会话的问题。现有原语无法提供这种产品形态：[会话存储 fork](../../implemented/feature/2026-06-30-session-store-fork-api.zh.md) 创建的是一个未绑定的会话，而 [fork subagent](../../implemented/feature/2026-06-21-subagent-capability-seam.zh.md) 是模型驱动的任务，其 transcript（文本记录）会折叠为一条工具结果。两者都不能给用户一个独立的对话，也都不能在父会话中同时记录结论和产生该结论的侧会话。

## 决策

**侧会话（side session）**是一个普通的活跃会话，从源会话的最后一个已完成轮次 fork 而来，绑定到自己的 agent（智能体），定位为只读顾问，并能**合并回写**一条精简笔记。所有权在 `@maple/sidechat`（`ctx.sidechat`）。

- **Fork 并绑定：**`ctx.sidechat.fork(parent)` 通过 `ctx.agents.create({ seed, meta })` 以父会话的平衡已完成轮次前缀创建子会话，并标记 `parentSession`、`seedLength` 与 `origin: 'sidechat'`。未新增核心会话存储方法。
- **顾问定位：**发布后在种子（以及自动的 `session/end-seed`）之后恰好追加一条插件来源的 `user/message`（`plugin: sidechat`，notice 形态）。系统提示词保持逐字节一致，从而保留提供方在继承历史上的前缀缓存。
- **硬只读：**`tools/pre-execute` 监听器对 `origin: 'sidechat'` 的 agent 拒绝每一次工具调用，除非可见定义的 `isConcurrencySafe` 恰好返回 `true`（执行模式 `parallel`）。普通会话与 subagent 会话不受影响。
- **合并回写：**`ctx.sidechat.mergeBack(parent, child, note?)` 向父会话追加一条有长度上限的 `user/message`，来源为 `plugin: sidechat`。省略 `note` 时使用子会话最新的 assistant 文本。配置 `mergeMaxChars`（默认 2000）约束每次 handback。父会话的下一次请求在日志所记录的位置看到该笔记，无需新的会话事件类型。
- **呈现：**Web 会话切换与 handback 渲染延后到首个绑定界面；本变更仅交付 Host 机制与单元覆盖。快照覆盖随该界面一起落地。

回退产品化、会话树视图、面向模型的侧会话工具，以及 `forkName`/`mergedInto` 元数据仍不在范围内。

## 曾考虑的替代方案

- **使用 subagent seam：**否决。侧会话是用户驱动的、客户端可见的，且可能存活超过父会话的一个轮次；subagent 是模型驱动的运行，返回一条工具结果。
- **修改子会话的系统提示词：**默认否决，因为任何字节变化都会从第零个 token 起使前缀缓存失效。部署方仍可选择这种更强的隔离方式。
- **新增 `sidechat/*` 事件：**延后。已标注来源的 `user/message` 已经持久记录内容、生产方和回放输入；只有当某个界面需要差异化渲染时，专用事件才有正当理由。
- **现在就绑定一个协议接口：**否决。当前 UI 由客户端拥有。实时呈现最终必须从持久消息派生，以使回放渲染出相同的记录。`ctx.sidechat` 的 Host RPC 包装随首个 Web 切换器一起落地。
- **仅建议性质的只读：**本次落地否决；拒绝门禁通过 `tools/pre-execute` 强制执行。

## 后果

`SessionHeader.origin` 为 `'subagent' | 'sidechat'`。与 subagent 来源行不同，sidechat 子会话仍出现在普通会话列表中。持久化 JSONL/SQLite 与 Host 摘要 schema 接受新 origin。base bundle 挂载 `@maple/sidechat`。单元测试覆盖 fork/绑定、合并回写上限与拒绝门禁；Web 快照覆盖等待客户端切换器。
