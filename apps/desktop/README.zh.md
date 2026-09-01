# @maple/desktop

[English](README.md) | 中文

Maple 桌面外壳：在 harness 自己的本地服务器之上提供一个原生窗口。外壳只拥有窗口与进程生命周期——RPC 网关、插件名册、工具与原生目录选择器全部仍归所组合的 `web` profile 所有，外壳以子进程方式启动它。

## 工作方式

`src-tauri/src/main.rs` 启动 `dsh web --no-open --port 0`（操作系统选定的端口，不打开浏览器），监视子进程的 stdout，等待 `@deepseek-ai/maple-web-app` 在绑定后打印的就绪行 `dsh web: http://127.0.0.1:<port>`，然后把窗口从内置启动页导航到该 URL。浏览器表面拥有的每一项能力——RPC 网关、插件名册、原生目录选择器——都仍由 harness 组合持有；外壳只添加窗口与生命周期。

加载的页面得不到任何 Tauri IPC：UI 只通过自己的 `/api` 源与 harness 通信。

生命周期保证：

- 宿主子进程运行在一个 kill-on-close 的 Windows 作业对象里，因此即使外壳未经清理路径就死掉，它也不可能比外壳活得更久——端口与文件监视器由内核回收。
- 关闭窗口会终止宿主；宿主退出会关闭外壳；有意的终止绝不会被报告为崩溃。
- 致命的启动条件（找不到仓库根、spawn 失败、非法 `MAPLE_DESKTOP_LAUNCH`、就绪截止）在 release 构建中以原生对话框呈现——那里没有 stderr 可读——在 debug 构建中则打到 stderr。
- 源码平面的启动静默 45 秒后，会打印一次指向构建产物回退的提示；180 秒截止仍然会关闭外壳。
- 二次启动不会再起一个宿主：既有窗口取得焦点。

## 用法

```sh
pnpm install        # once per checkout
pnpm desktop:dev    # debug shell + host launched from source through tsx
```

打包构建运行的是构建后的 CLI 而非源码树，所以先构建：

```sh
pnpm run build              # produces apps/cli/lib/bin.js
pnpm desktop:build          # stages sidecar resources, then NSIS installer
```

`pnpm desktop:build` 会运行 `scripts/prepare-sidecar.mjs`，将 `apps/cli/lib/bin.js` 与 Node 二进制复制到 `src-tauri/sidecar/`，再由 Tauri 作为资源打包。可用 `NODE_SIDECAR=/absolute/path/to/node` 覆盖 Node 副本。

Release 安装优先使用捆绑 sidecar（`sidecar/node` + `sidecar/cli/bin.js`）；未准备这些资源的解包 `cargo build --release` 会回退到系统 `node` 加检出中的 `apps/cli/lib/bin.js`。

仓库根通过从工作目录与可执行文件向上查找来定位，再读取本应用数据目录（`%APPDATA%\app.maple.desktop\`）下的 `repo-root.txt` 提示文件或可执行文件旁的 `maple-desktop.repo` 文件；`MAPLE_DESKTOP_REPO_ROOT` 覆盖一切。任一提示文件指向检出后，双击已安装二进制即可工作。

### 启动平面

Debug 构建经 tsx ESM 钩子从源码启动 CLI；release 构建在存在时优先使用捆绑 sidecar，否则使用系统 `node` 加 `apps/cli/lib/bin.js`。设置 `MAPLE_DESKTOP_LAUNCH=source`、`=built` 或 `=bundled` 可覆盖。当 tsx 钩子在很深的嵌套进程树下卡住时（已在 agent 沙箱中观察到），这个覆盖就有用：先 `pnpm run build`，再用 `MAPLE_DESKTOP_LAUNCH=built pnpm desktop:dev` 从构建产物启动。

## 已知限制与延期工作

- 打包二进制仍为插件组合解析仓库检出；sidecar 携带 Node 与已构建 CLI，但不携带完整工作区树。
- Unix 上宿主子进程在独立会话中运行，发往桌面外壳的信号不会扇出到 Node 树；Windows 使用 kill-on-close 作业对象。
- 窗口关闭经 `TerminateProcess` 终止宿主，跳过 harness 的优雅处置（配置监视器、遥测排空）；会话为懒持久化，持久内容不受影响。
- macOS 与 Linux 未测试：作业对象守卫仅限 Windows，其他平台只剩显式清理。

