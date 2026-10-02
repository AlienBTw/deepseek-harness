# @maple/run-budget

[English](README.md) | 中文

可选的单次 agent 驱动唤醒花费上限。该插件不会作为工具出现：它监听 `agent/status`、`agent/pre-step` 与 `agent/request`；当即将超过已配置上限时，会以持久的 `{ kind: 'quota', code }` 原因结束当前轮次，而不是静默的 `blocked`。决策记录：[run-budget Agent Note](../../../.agents/notes/implemented/feature/2026-09-28-run-budget-spend-caps.zh.md)。

## 配置

```yaml
- id: run-budget
  name: '@maple/run-budget'
  config:
    maxTurnsPerRun: 8              # optional; positive safe integer
    maxOutputTokensPerTurn: 8192   # optional; positive safe integer
```

两个字段均可选。全部省略时插件保持空操作。已给出但不是正安全整数的值会在插件加载时失败。

## 强制执行

- **`maxTurnsPerRun`** — 在一次 idle→running→idle 唤醒期间统计 `turn/start` 准入。第 N+1 轮的首个步骤会在该轮次已经打开之后以 `{ kind: 'quota', code: 'MAX_TURNS' }` 拒绝，因此会话日志会留下明确的配额结束记录。工具续步仍留在已准入的轮次内，不再消耗额外预算。
- **`maxOutputTokensPerTurn`** — 将每次对话模型请求的 `maxTokens` 钳制到该上限。已有更严的 agent 或 waterfall 上限会保留；更高或缺失的值会被替换。触及提供方输出上限时仍记录普通的 `max-tokens` 轮次结束。

同会话 Goal 轮次仍由 `@maple/goal` 的 `maxGoalRounds` 预算负责；本插件是普通唤醒的部署级花费围栏。

## 模型体验

### 配额轮次结束

#### 模型看到什么

没有额外提示文本。超过轮次上限的那一轮会在不发起模型调用的情况下关闭。客户端与 ACP 将 `MAX_TURNS` 映射为 `max_turn_requests`，将输出上限触及映射为 `max_tokens`。

#### Token 影响

被拒绝的轮次消耗零 token。钳制后的 `maxTokens` 限制每一次已准入请求。

#### KV Cache 影响

除普通轮次边界外无额外影响。

## 已知限制与延后工作

- **没有软性美元估算** — 计费费率表不在范围内；消耗 UX 读取现有的 `tokenUsage` 投影。
- **没有跨唤醒累计** — 每次驱动唤醒都会重置轮次计数器；持久的会话生命周期预算仍是单独策略。
