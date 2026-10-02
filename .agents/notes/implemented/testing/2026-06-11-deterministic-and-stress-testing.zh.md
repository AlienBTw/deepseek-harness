# Agent Note: 确定性测试、回放不变式 fixture 与竞态压力测试

Status: implemented

[English](2026-06-11-deterministic-and-stress-testing.md) | 中文

## 问题

若干 agent loop（智能体循环）测试通过 `setTimeout(N)` 睡眠来同步——这是一笔不稳定性债务，浪费 agent 的重试周期，还可能掩盖时序 bug。另外，核心架构承诺（任何会话日志回放后都能得到相同的派生历史）此前只在少数测试中断言，尽管在更广范围断言的成本极低。inbox 唤醒竞态只被手动验证过一次，没有任何机制持续复验。

## 决策

三项基础一并交付：

1. **事件驱动等待，门禁约束睡眠。** `@maple/agent-loop-testkit` 导出 `waitForIdle`、`waitForStatus` 与 `waitForSessionEvent`，用于等待 `agent/status` 与 `session/event` 发布。优先使用它们（或在测试时间本身时使用 vitest fake timer），而不是挂钟睡眠。`pnpm run verify-no-settimeout-in-tests` 扫描 `packages/*/*/tests/**/*.{ts,tsx}`，对 `scripts/settimeout-test-allowlist.json` 之外的任何 `setTimeout` 失败。过期的白名单条目也会失败，以便列表随文件迁移而收缩。该门禁挂在静态 CI / hygiene 聚合中。

2. **通用回放辅助函数。** 同一包导出 `assertDeriveMessagesReplay`、`withDeriveMessagesReplay` 与 `SessionReplayTracker`：测试变更实时会话后，辅助函数用 `[...session.events]` seed（播种）一个全新的 `Session`，并断言 `deriveMessages()` 相等。agent-loop 规格测试率先采用（`loop.spec.ts` 与 testkit 自身覆盖）；其余套件随白名单睡眠消失而渐进迁移。

3. **夜间压力测试骨架。** `.github/workflows/test-stress-nightly.yml`（以及 `pnpm run test:stress:agent-loop`）反复打乱运行 agent-loop 与 agent 套件。Vitest 4 没有 `--repeats` CLI，因此 workflow 循环打乱后的轮次；当运行器提供 `--repeats` 时，用单次调用替换循环。不要添加 `--retry`：在此发现的不稳定现象一律视为需修复的 bug。在套件消除睡眠后再提高迭代次数。

## 后果

新的包测试不能在未列入白名单的情况下添加 `setTimeout`，否则 CI 会失败。回放相等只需一次辅助函数调用，套件可以积累数百次回放检查而不复制 seed/断言样板。夜间 job 有意保持为骨架，默认迭代次数适中，直到睡眠消失；它现在就写明不重试策略，以免后续加压时重新引入用不稳定重试掩盖问题的做法。回放 fixture 在全套件的采用与白名单清零仍是后续工作，不依赖第二次决策。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
