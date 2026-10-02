# Agent Note: OS 钥匙串凭据提供方

Status: implemented

[English](2026-09-28-os-keychain-credentials-provider.md) | 中文

## 问题

文件型凭据提供方把机密存放在 `$MAPLE_HOME/.credentials.yaml`（`0600`）。这挡得住其他 OS 用户，挡不住模型同 UID 的 bash 与文件系统工具。必须让提供方密钥远离自身 agent 的部署，需要一种这些工具无法当作普通文件打开的存储。凭据 seam 已为钥匙串后端预留位置；[凭据边界](../architecture/2026-07-30-credential-boundaries-and-atomic-registration.zh.md) 把交付它记为延后项。

## 决策

与 `credentials-local` 并列的 `@maple/credentials-keychain` 通过 `@napi-rs/keyring`（维护中的 napi-rs 绑定，覆盖 macOS Keychain、Windows Credential Manager、Linux Secret Service）实现 `CredentialProvider`。Config 选择存储后端：`os` 用于生产，`memory` 用于测试与 CI。测试套件还可传入程序化的 `store`（`KeychainBackend`），使覆盖率不必依赖真实钥匙串。解析保持与文件提供方相同的环境分层（`env` > keychain > `.env` 后备）；只有受管存储离开磁盘。记录以 JSON 存放在 `#record/<scope>/<id>` 下，并用持久的 `#index/records` 列表支持枚举，因为该绑定没有列出凭据的 API。

`maple-base` 默认仍使用 `@maple/credentials-local`。选用钥匙串提供方是对 `credentials` 行的组合替换；两个包都可用，且绝不同时挂载。

## 曾考虑的替代方案

**交付 keytar。** 已拒绝：上游已归档；`@napi-rs/keyring` 仍在维护，并覆盖同一组 OS 存储。

**把文件提供方从默认位换掉。** 已拒绝：无头 CI 与简单部署仍需要不依赖桌面钥匙串的文件文档；更强边界保持可选。

**把两种后端收进同一包，由 Config 选择 file 或 keychain。** 已拒绝：各后端拥有不同的失败模式、权限与依赖；平级包可让文件提供方的表面与可选原生依赖保持隔离。

**在单元测试中要求真实 OS 钥匙串。** 已拒绝：CI 主机与沙箱常常没有已解锁的 Secret Service；可注入的 `KeychainBackend` 加上 `backend: memory` 即可在无该依赖时达到 100% 覆盖。

## 后果

能力目录同时列出两个提供方。包测试覆盖引用与记录路径、遮蔽、dispose 竞态、损坏载荷，以及通过假 Entry 工厂覆盖的 OS 适配器。跨进程记录读-改-写没有 harness 级锁（后写胜出），与文件提供方对同一引用并发写入的已文档化限制一致。
