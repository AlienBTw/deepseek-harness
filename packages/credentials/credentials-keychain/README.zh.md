# dsh-credentials-keychain

[English](README.md) | 中文

OS 钥匙串[凭据](../credentials/README.zh.md)提供方：机密存放在宿主钥匙串中，而不是存放在模型同 UID 工具可以直接读取的文件里。

| 层 | 来源 id | 可写 | 优先 |
|---|---|---|---|
| 继承的进程环境 | `env` | 否 | 始终优先 |
| OS 钥匙串（`Config.service`） | `keychain` | 是（`set`/`unset`） | 高于两个 `.env` 层 |
| `<invocation cwd>/.env` | `project-env` | 不在此处 | 高于用户 `.env` |
| `$MAPLE_HOME/.env` | `user-env` | 不在此处 | 其余情况 |

环境语义与 [`dsh-credentials-local`](../credentials-local/README.zh.md) 一致：按次覆盖保持可见只读，Models 页写入的密钥会取代 `.env` 后备成为生效来源。受管存储是 OS 钥匙串（macOS Keychain、Windows Credential Manager 或 Linux Secret Service），经 [`@napi-rs/keyring`](https://www.npmjs.com/package/@napi-rs/keyring) 访问——agent 的文件系统与 shell 工具无法把它当作普通文件打开。

[`maple-base`](../../bundle/base/README.zh.md) 默认仍使用文件提供方。需要更强边界的部署把 `credentials` 行换成本包；两个提供方实现同一个 `ctx.credentials` seam，且绝不同时挂载。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `service` | `maple-harness` | 本提供方名下所有账户共用的钥匙串服务名。 |
| `backend` | `os` | `os` 访问宿主钥匙串；`memory` 是供测试与 CI 使用的进程内 Map。 |

程序化启动还可以传入 `store`（一个 `KeychainBackend`）以注入 mock，而不必选择 `memory`；YAML 组合无法设置该字段。

## 组合方式

除非需要钥匙串边界，否则继续使用 `@maple/credentials-local`。要选用本包，声明依赖并替换 credentials 行：

```yaml
- id: credentials
  name: '@maple/credentials-keychain'
  config:
    service: maple-harness
    backend: os
```

## 存储布局

在 `Config.service` 下：

| 账户 | 内容 |
|---|---|
| `<CredentialRef>` | 引用的机密字符串 |
| `#record/<scope>/<id>` | JSON `CredentialRecord` |
| `#index/records` | 已存储 `CredentialKey` 的 JSON 数组 |

空的存储值等于不存在（seam 规则）。记录写入只走 `modifyRecord`；索引随每次提交更新，并在 indexed 账户已消失时自愈。

## 安全边界

与文件提供方的 `0600` 文档不同——后者挡得住其他 OS 用户、挡不住同 UID 的 agent 工具——钥匙串是 OS 凭据存储。工具进程拿不到可以 `cat` 的路径，普通工作区文件系统策略也不会授予钥匙串访问。继承的环境值仍按现有规则解析；只有提供方受管存储离开了磁盘。

## 模型体验

经由消费它的 LLM（大语言模型）适配器间接生效：存储的值为适配器向提供方发出的请求授权，所有模型可见内容均由适配器负责。

#### KV Cache 影响

无直接失效；凭据绝不进入请求前缀。

## 已知限制与暂缓事项

- **同一引用的并发写入是后写胜出**——单个进程串行化自身写入者；OS 账户替换按账户原子，但跨进程的记录读-改-写没有 harness 级锁。
- **记录枚举依赖持久索引**——`@napi-rs/keyring` 没有列出凭据的 API；`#index/records` 账户是权威来源，并在账户缺失时自愈。
- **环境变化不可见**——启动快照冻结；更换来自环境的凭据需要重启。
- **Linux Secret Service 可能弹窗**——锁定的 keyring 会在会话解锁前阻塞或让 get/set 失败。
