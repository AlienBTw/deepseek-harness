# @maple/desktop

[English](README.md) | 中文

Maple 桌面外壳：在 harness 自己的本地服务器之上提供一个原生窗口。外壳只拥有窗口与进程生命周期——RPC 网关、插件名册、工具与原生目录选择器全部仍归所组合的 `web` profile 所有，外壳以子进程方式启动它。

## 工作方式

`src-tauri/src/main.rs` 启动 `dsh web --no-open --port 0`（操作系统选定的端口，不打开浏览器），监视子进程的 stdout，等待 `@deepseek-ai/dsh-web-app` 在绑定后打印的就绪行 `dsh web: http://127.0.0.1:<port>`，然后把窗口从内置启动页导航到该 URL。浏览器表面拥有的每一项能力——RPC 网关、插件名册、原生目录选择器——都仍由 harness 组合持有；外壳只添加窗口与生命周期。

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
pnpm run build      # produces apps/cli/lib/bin.js
pnpm desktop:build  # NSIS installer under src-tauri/target/release/bundle
```

仓库根通过从工作目录与可执行文件向上查找来定位；在检出布局之外启动时请设置 `MAPLE_DESKTOP_REPO_ROOT`。

### 启动平面

Debug 构建经 tsx ESM 钩子从源码启动 CLI；release 构建运行 `apps/cli/lib/bin.js`。设置 `MAPLE_DESKTOP_LAUNCH=built` 或 `=source` 可双向覆盖默认值。当 tsx 钩子在很深的嵌套进程树下卡住时（已在 agent 沙箱中观察到），这个覆盖就有用：先 `pnpm run build`，再用 `MAPLE_DESKTOP_LAUNCH=built pnpm desktop:dev` 从构建产物启动。

## 已知限制与延期工作

- 打包出的二进制仍解析仓库检出与系统 `node`：真正的独立打包（sidecar Node 运行时加作为 Tauri 资源的已构建 CLI）尚未实现。
- 窗口关闭经 `TerminateProcess` 终止宿主，跳过 harness 的优雅处置（配置监视器、遥测排空）；会话为懒持久化，持久内容不受影响。
- macOS 与 Linux 未测试：作业对象守卫仅限 Windows，其他平台只剩显式清理。

