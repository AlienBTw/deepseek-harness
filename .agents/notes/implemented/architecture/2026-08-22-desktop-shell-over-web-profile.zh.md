# Agent Note：以单一窗口承载 web profile 组合的桌面外壳

Status: implemented

[English](2026-08-22-desktop-shell-over-web-profile.md) | 中文

## Problem

Harness 的浏览器界面已经通过回环 HTTP 提供了完整 GUI——RPC 网关、插件名册、工具、原生目录选择器——但触达它需要终端（`dsh web`）加一个浏览器标签页，而且它的生命周期与操作者关闭的任何东西都互不相关。一个重新实现其中任何表面的桌面应用都会让产品分叉；只用原生窗口包裹它而不接管其进程，又会留下孤儿服务器和静默失败。

## Decision

`apps/desktop` 是一个 Tauri v2 二进制，其全部职责就是在既有 `web` profile 组合之上提供窗口与进程生命周期。它把 `node <cli> web --no-open --port 0` 作为子进程启动，解析 web bundle 在绑定后打印的就绪行 `dsh web: http://127.0.0.1:<port>`，然后把一个 webview 从内置启动页导航到该 URL。加载的页面得不到任何 Tauri IPC：UI 继续只与自己的 `/api` 源通信。

生命周期与失败行为：

- 宿主子进程运行在一个 kill-on-close 的 Windows 作业对象里，因此即使外壳未经自己的清理路径就死掉，内核的句柄回收也会收割它。
- 关闭窗口会终止宿主；宿主退出会关闭外壳；有意的终止绝不会被报告为崩溃（stdout 泵由 `KILLING_HOST` 把关）。
- 致命的启动条件在 release 构建中以原生对话框呈现（`windows_subsystem` 让它们没有 stderr），在 debug 构建中则打到 stderr。
- 启动平面为 debug → 经 tsx 的源码、release → 构建好的 `apps/cli/lib/bin.js`；`MAPLE_DESKTOP_LAUNCH=built|source` 可双向覆盖。源码平面的启动若静默 45 秒，会打印一次指向构建产物的提示，之后 180 秒截止即退出。
- 二次启动会让既有窗口取得焦点，而不是再起一个宿主。

## Alternatives considered

**为什么不把前端 dist 内嵌进 webview、改走与无头宿主的 IPC？** 内嵌 dist 意味着外壳要自己接管 API 路由、插件服务与信任围栏——这些 `@deepseek-ai/maple-web-app` 已经拥有——而且每一项 harness 能力都得有一条并行通路进入 webview。经由真实组合来服务，让一个表面只有一个所有者。

**为什么不让 Tauri 对话框充当目录选择器后端？** 该 seam 已经组合了 `ctx.directoryPicker` 之后的多个后端；第三个后端会为毫无新增能力而复制 Win32 koffi 实现，且 koffi 选择器在被拉起的宿主下原样可用。

**为什么不在 tsx 卡住时自动回退到构建产物？** 在启动中途杀掉并重启会引入第二种失败模式（第一次尝试成为孤儿、端口双重探测），去掩盖一个环境特定的卡顿。响亮的提示加上显式覆盖，让每次调用只有一条启动路径。

## Consequences

打包出的安装程序仍要求仓库检出与系统 `node`——真正的独立打包（sidecar 运行时加捆绑 CLI）继续延期。窗口关闭经 `TerminateProcess` 终止宿主，跳过优雅处置；会话是懒持久化的，持久内容不受影响。macOS 与 Linux 未测试：作业对象守卫仅限 Windows，其他平台只剩显式清理这一层。

