# Agent Note: 供应链检查与 vendor 漂移验证

Status: implemented

[English](2026-06-11-supply-chain-and-vendor-drift.md) | 中文

## 问题

vendor manifest（元数据清单）（见[引入 vendor 的决策](2026-06-11-vendor-cordis-as-source.zh.md)）在提交时仅在*正向*强制执行（vendor 变更 ⇒ manifest 更新），但此前没有任何机制验证 manifest 的*声明*：即 `vendor/` 确实等于上游指定 SHA 的内容加上所记录的修改。普通 NPM 依赖也缺少按计划的安全公告监控。

## 决策

交付三项互补检查：

1. **许可证清单** — `pnpm run verify-vendored-licenses` 断言每个 vendor 包都携带 `LICENSE` 文件，且各 `package.json` 的 `license` 与 `vendor/README.md` 中的[许可证清单](../../../../vendor/README.md#license-inventory)表一致。该检查在 `hygiene` 与 CI static 聚合中运行。
2. **依赖安全公告** — `pnpm run audit:deps` 对 lockfile 运行 `pnpm audit --audit-level high`。`.github/workflows/supply-chain.yml` 在夜间计划任务、触及 lockfile 的 push/PR，以及 vendor patch / 相关脚本变更时运行它。
3. **Vendor 漂移脚手架** — 在可访问上游时，`pnpm run verify-vendor-drift` 依据 manifest SHA 与 `vendor/patches/` 下已签入的 diff 重建包。`pnpm run verify-vendor-drift:offline`（hygiene / CI static / supply-chain 工作流）校验 patch 索引，并确认 `add-file` patch 与磁盘文件一致。日志条目 5 与 13 的可落地 patch 已签入；整文件重生与大型多文件增量仍列在 `vendor/patches/index.json#unpatchedLogEntries`，待本地 sync 捕获。

私有上游镜像常会阻断 CI clone。已记录的本地 agent（智能体）任务是在具备 cordis-workspace 凭证的机器上运行 `pnpm run verify-vendor-drift`（见 [vendor/patches/README.md](../../../../vendor/patches/README.md)）。

Renovate（或以小 PR 提议 NPM 更新的定时 agent 任务）仍然推迟；Dependabot 已按 cron 覆盖 npm/uv/actions，且 vendor 包仍排除在 registry 更新之外。

## 曾考虑的替代方案

- **用 `pnpm audit` 替代 osv-scanner** — 两者都满足安全公告扫描；本次落地选用 `pnpm audit`，因为它已可通过固定的包管理器使用，无需额外二进制。
- **用定时 agent 任务替代 Renovate** — 仍可用于提议依赖升级；Dependabot 提供过渡期节奏，而 vendor 包无论哪种方案都继续走 manifest 同步流程。
- **在每一次上游 clone 都被阻断时让 CI 硬失败** — 否决：在离线脚手架阶段，私有远程会让 supply-chain 工作流无端变红却证明不了漂移。clone 被阻断时在 patch 索引检查通过后报告本地 agent 任务并成功退出；成功 clone 后仍无法解释的 diff 会失败。

## 后果

- 缺少 vendor `LICENSE` 或与清单不符时，合并前 hygiene 与 CI static 会失败。
- 高危 lockfile 安全公告按计划浮现，并在触及 lockfile 的 PR 上出现，而不阻断无关的文档变更。
- 已被 patch 覆盖的本地修改成为可验证产物；其余日志条目仍需在常规上游 sync 时捕获为 patch。
- 完整的 SHA+patch 重建在 runner 获得私有远程访问之前，仍是需凭证的本地（或未来带 token 的 CI）任务。
