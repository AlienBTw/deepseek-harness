# Agent Note: web-fetch-http 的 SSRF 目标策略

Status: implemented

[English](2026-09-28-web-fetch-ssrf-destination-policy.md) | 中文

## 问题

`@maple/web-fetch-http` 在完成协议、凭据与长度检查后即接受任意 http(s) URL。模型（或重定向）可以指向 loopback、RFC1918、link-local 云元数据（`169.254.169.254`）或多播地址。[web 能力 seam](2026-06-24-web-capability-seam.zh.md) 将完整 SSRF 防护暂缓，并要求在能触及内部目标的部署中不要启用 fetch；因此只要挂上该提供方，唯一的 HTTP 抓取后端就仍是 SSRF 原语。

## 决策

在 `@maple/web-fetch-http` 中默认启用目标策略：

1. 在 `validateFetchUrl` 之后解析该跳的主机名（或使用字面 IP），拒绝被归类为私有（RFC1918 + CGNAT `100.64/10`）、loopback、link-local、multicast、IPv6 ULA／link-local／multicast／loopback／未指定，或上述 IPv4 范围之 IPv4 映射形式的地址（`WEB_BLOCKED_URL`）。
2. 在同源校验之前，对每一跳重定向执行相同检查，使指向私有 IP 的 Location 与同主机 DNS rebind 均失败关闭。
3. 逃逸口仅为显式配置 `allowPrivateNetwork: true`（默认 `false`），供受信实验室配置（loopback fixture、本地集成测试）使用。其他设置不得关闭这些检查。

分类逻辑位于 `policy.ts`（`isBlockedIpAddress`、`assertPublicFetchDestination`）；提供方在初始 URL 与每个重定向目标上调用断言。

## 考虑过的替代方案

- **不做 DNS 的主机名／前缀黑名单。** 否决：漏掉 rebinding 与 IP 字面量；seam 笔记已要求先解析再验证。
- **主机名只要有任意公网 A/AAAA 记录就静默放行。** 否决：连接路径仍可能选中私有地址。
- **同变更内把 TCP 连接钉到已验证地址（自定义 undici dispatcher／IP URL + Host 标头）。** 暂缓：可关闭 lookup 到 connect 的 TOCTOU 窗口；Wave 1.5 先交付解析后再验证与逐跳重检。包 README 与 seam 笔记仍将其列为暂缓工作。
- **通过环境探测在测试路径默认 `allowPrivateNetwork: true`。** 否决：等于静默逃逸口；实验室配置与测试须显式设置该标志。

## 后果

**默认配置下，fetch 不再是 SSRF 原语。** 未设置 `allowPrivateNetwork` 时挂载 `web-fetch-http` 会在 DNS 后拒绝非公开目标。

**抓取 loopback 的实验室与快照组合必须设置 `allowPrivateNetwork: true`。** ACP web-fetch fixture 以及驱动 `127.0.0.1` 的包／集成测试在配置或 `HttpFetchLimits` 中显式打开该标志。

**钉到已验证 IP 仍属暂缓。** 在 `dns.lookup` 与 `fetch(hostname)` 之间，解析结果仍可能在连接前改变；逐跳重新解析降低重定向 rebinding，但不关闭同一跳的 TOCTOU。

## 必要验证

- 针对被拦 IPv4／IPv6 范围（含元数据 link-local 与 IPv4 映射形式）、`allowPrivateNetwork` 跳过、重定向到私有 IP 字面量、以及跨重定向跳的同主机 DNS rebind 的单元测试。
- 插件默认（`allowPrivateNetwork: false`）拒绝 loopback；显式 `true` 允许包内 loopback fixture 服务器。
