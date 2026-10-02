# `@maple/sidechat`

[English](README.md) | 中文

交互式侧会话：在父会话的平衡已完成轮次前缀处 fork 出只读顾问子会话，再将一条有长度上限的 handback 笔记合并回父会话。决策记录：[交互式侧会话](../../../.agents/notes/implemented/feature/2026-07-08-interactive-side-sessions.zh.md)。

## 服务 API

- `ctx.sidechat.fork(parent, options?)` — 通过 `ctx.agents.create({ seed, meta })` 创建子会话，写入 `parentSession`、`seedLength` 与 `origin: 'sidechat'`，再追加一条插件来源的顾问定位 `user/message`。父会话日志不变。若没有匹配的已完成轮次则抛出 `SidechatForkError`。
- `ctx.sidechat.mergeBack(parent, child, note?)` — 向父会话追加一条有长度上限的 `user/message`，来源为 `plugin: sidechat`。省略 `note` 时使用子会话最新的 assistant 文本。谱系或笔记无效时抛出 `SidechatMergeError`。

配置字段 `mergeMaxChars`（默认 2000）约束每次 handback。

## 只读拒绝门禁

`tools/pre-execute` 监听器对 `origin: 'sidechat'` 的 agent 拒绝每一次工具调用，除非可见定义的 `isConcurrencySafe` 分类器恰好返回 `true`（执行模式 `parallel`）。普通会话与 subagent 会话不受影响。

## 模型体验

### 顾问定位

#### 模型所见

在继承前缀之后恰好一条插件来源的 notice，告知子会话只做解释，不执行变更或继续父任务。系统提示词与父会话逐字节一致，从而保留提供方在继承历史上的前缀缓存。

#### Token 影响

子会话日志中一条持久定位消息；在子会话生命周期内保留。

#### KV Cache 影响

在继承前缀之后仅追加；不使父会话已缓存的系统提示词或种子历史失效。

### 合并回写

#### 模型所见

父会话收到一条 notice 形态的 `user/message`（`Side-session handback:` 加上有上限的笔记），位于日志记录的位置。父会话的下一次请求与回放在该处看到它。

#### Token 影响

每次合并受 `mergeMaxChars` 约束。

#### KV Cache 影响

在父会话上仅追加；先前的前缀缓存保持有效。

## 已知限制与延后工作

- **Web UI 切换器与 handback 渲染随后落地** — 本包仅拥有 Host 机制；客户端会话切换与差异化 handback 呈现随首个绑定界面一起落地（届时再补快照覆盖）。
- **变更分类遵循 `isConcurrencySafe`** — 未声明并发安全的变更工具会被拒绝；省略该分类器的只读工具也会被拒绝（失败封闭）。
- **无 `forkName` / `mergedInto` 元数据** — 谱系仅使用既有的 `parentSession` / `seedLength` / `origin`。
