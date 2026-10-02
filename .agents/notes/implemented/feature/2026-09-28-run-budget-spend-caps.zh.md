# Agent Note: Run-budget 花费上限与消耗 UX

Status: implemented

[English](2026-09-28-run-budget-spend-caps.md) | 中文

## 问题

部署需要可选上限：一次驱动唤醒最多打开多少轮，以及每次对话请求最多索取多少输出 token。若没有明确的停止原因，pre-step 否决看起来像普通策略拦截，客户端也无法映射到 ACP 的 `max_turn_requests`／`max_tokens`。用户还需要把现有的 `tokenUsage` 与 `contextPressure` 投影在 Web composer 统计条中呈现为消耗与占用；交互式 CLI TUI 已移除，因此该统计条就是产品侧的归宿。

## 决策

`packages/guard/run-budget/` 中的 `@maple/run-budget` 是由 Config 驱动的 guard。可选的 `maxTurnsPerRun` 与 `maxOutputTokensPerTurn` 为正安全整数，并在加载时校验。两者都省略时插件保持空操作。

轮次记账以 live `Agent` 为键放入 WeakMap，并在每次 idle→running 唤醒时重置。第 N+1 轮的首个步骤会在 `turn/start` 已经打开之后以 `{ kind: 'quota', code: 'MAX_TURNS' }` 拒绝，因此持久日志会留下配额结束记录。输出上限钳制 `agent/request` 的 `maxTokens`，并保留任何已更严的值。`TurnEndReasonMap` 增加 `quota`，`PreStepDecision` 的 reject 可携带 reason，ACP 将 `MAX_TURNS` 映射为 `max_turn_requests`。

Web `StatsLine` 在现有 token 分组旁增加消耗合计（计费输入 + 输出）以及紧凑的上下文占用百分比；`ContextMeter` 仍是主要的占用圆环。

同会话 Goal 轮次仍由 `@maple/goal` 的 `maxGoalRounds` 负责；本插件是普通唤醒的部署级围栏。

## 考虑过的替代方案

**只把上限放在 `AgentOptions`／agent-loop Config。** 作为唯一归属被拒绝：部署已用循环卫生 guard 组合策略，不应再强制逐 agent 选项管道；agent 的 `maxTokens` 仍作为 guard 可进一步钳制的每 agent 种子。

**以 `{ kind: 'blocked' }` 拒绝。** 被拒绝：客户端与 ACP 无法区分花费上限与普通提示否决。

**跨唤醒累计轮次或软性美元估算。** 本切片拒绝：跨唤醒预算与费率表需要产品归属，延后处理。

## 后果

base 与示例装配可用空 Config 挂载 `@maple/run-budget`。超过轮次上限会在不发起模型调用的情况下结束当前轮次。包测试覆盖加载失败、两轮配额结束与输出钳制。当多轮 ACP 场景编写成本可接受时，仍宜补一份展示停止原因的无密钥 ACP 快照。
