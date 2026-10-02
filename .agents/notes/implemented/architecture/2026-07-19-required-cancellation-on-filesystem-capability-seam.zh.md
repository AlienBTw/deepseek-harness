# Agent Note: 文件系统能力 seam 上的必填取消

Status: implemented

[English](2026-07-19-required-cancellation-on-filesystem-capability-seam.md) | 中文

## Problem

[工具注册表取消约定](./2026-07-19-cooperative-tool-cancellation.zh.md)已要求每个工具体持有 `exec.signal`，但异步 `ctx.fs` 操作仍接受可选 signal。因此文件系统工具可以在类型检查通过的同时，在路径解析、元数据探测、读取、列举或原子变更之前丢掉取消。

## Decision

在工具（或其他同进程消费方）仍拥有该操作期间，每一个可被 await 的 `FileSystem` 原语都要求 `AbortSignal`：

- `resolve(path, opts)` 要求 `opts: { cwd?: string; signal: AbortSignal }`
- `stat`、`lstat`、`readText`、`streamText`、`readBytes`、`listDir`、`writeText`、`editText` 使用必填的位置参数 `signal`
- `writeText` / `editText` 在 `signal` 之前保留显式的 `expected: … | undefined`（无可选重载；无条件变更传入 `undefined`）
- 同步辅助（`processPath`、`fileUrl`、`contains`、`sandboxMode`）保持无 signal

提供方（`fs-local`、`fs-sandbox`、`fs-e2b`）与第一方消费方（`tool-fs`、`tool-str-replace-editor`、`skill-filesystem`、`agent-instructions`、`lsp-stdio`）一并迁移。派生作用域仍链接到调用方 signal（`fs-sandbox` 在围栏重解析时使用变更 signal；LSP 在主机 I/O 前融合查询与生命周期 signal）。能力实现不合成永不中止的生产哨兵。外层协议仍允许省略取消的调用方，在进入 FS seam 前为该次调用拥有一个 controller。

这是[经工具可达能力 seam 的必填取消](./2026-07-19-required-cancellation-through-tool-capability-seams.zh.md)的文件系统族切片。Shell 与 web 族切片亦已实现；工作流／subagent／code-runtime 仍在该笔记中延期。

### 清单（第一方 FS 工具 → 被 await 的 FS 调用）

| 工具包 | 工具 | 被 await 的 `ctx.fs` 操作 |
|---|---|---|
| `@maple/tool-fs` | `read`、`read_image`、`write`、`edit` | `resolve`、`stat`、`readText`/`streamText`、`readBytes`、`writeText`、`editText` |
| `@maple/tool-str-replace-editor` | `str_replace_editor` | `resolve`、`stat`、`listDir`、`readText`、`writeText` |
| `@maple/tool-fs-search` | `glob`、`grep` | 无（subprocess/`rg`，不是 `ctx.fs`） |

## Alternatives considered

**因为工具已收到 signal，就让 FS signal 保持可选。** 拒绝：省略在每个可选能力调用处仍合法；TypeScript 无法证明传播。

**把 `writeText`/`editText` 重排为 `signal` 在可选 `expected` 之前。** 拒绝：seam 保持既有参数顺序；以显式 `| undefined` 槽位代替可选重载。

**让非工具 FS 消费方保持可选。** 拒绝：Service Definition 是同一 seam；拆成可选与必填两面会在共享调用点重新引入省略。

## Consequences

- TypeScript 拒绝省略 `signal` 的 FS 调用；[`signal-types.spec.ts`](../../../../packages/fs/fs/tests/signal-types.spec.ts) 钉住省略失败。
- 提供方与集成套件已证明取消到达副作用所有者（创建/重写文件前的 `FS_ABORTED`；工具注册表派发前中止分类）。
- 预发布立场：已迁移 seam 不保留兼容重载。
