# Agent Note：遥测端点暂留 DeepSeek 收集器

Status: implemented

[English](2026-08-23-telemetry-endpoint-deferred.md) | 中文

## Problem

品牌迁移将所有面向产品的名称从 DeepSeek 迁移到了 Maple，但 OTLP 遥测端点（`harness-telemetry.deepseeksvc.com`）没有 Maple 托管的对等物。在没有可用收集器的情况下更改 URL 会静默丢失所有遥测数据。

## Decision

遥测导出器 URL 目前保留在 `harness-telemetry.deepseeksvc.com`。`MAPLE_TELEMETRY_OTLP_URL` 环境变量（从 `DSH_TELEMETRY_OTLP_URL` 改名而来）已支持按部署覆盖，因此需要不同收集器的部署无需代码更改即可设置。基础 bundle 的默认值是已知的延期项，而非遗漏。

## Alternatives considered

**为什么不现在部署新的收集器？** 尚无 Maple 托管的基础设施；部署收集器是属于本仓库范围之外的一项独立运维任务。

**为什么不直接删除默认 URL？** 遥测是可选的（`MAPLE_TELEMETRY_MODE` 默认为 `DISABLED`），因此除非部署显式启用上报，否则该 URL 是惰性的。删除它会导致第一个选择加入的部署无法工作。

## Consequences

`deepseeksvc.com` 主机名出现在一个配置默认值中（`packages/bundle/base/cordis.patch.yml`）。启用遥测但未覆盖 `MAPLE_TELEMETRY_OTLP_URL` 的部署会将数据发送到 DeepSeek 托管的收集器。在产品处于预发布阶段且遥测默认关闭的情况下，这是可以接受的。
