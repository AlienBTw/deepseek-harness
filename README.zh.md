# Maple Harness

[English](README.md) | 中文

Maple Harness（maple / mph）是一个开源、模块化的 AI agent harness，专注于 token 效率、AST 仓库映射、主权代理可观测性与顺滑的开发者工作流。

它构建于可扩展的**一切皆插件**架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，并源自 [Maple Harness](https://github.com/deepseek-ai/deepseek-harness) 基础。

---

## 关键能力

* **省 Token 的上下文引擎**：内置覆盖 14 种语言的 Tree-Sitter AST 仓库映射，配合 PageRank 个性化，把提示开销保持在约 2k token 的低位。
* **主权的 BYOK 代理集成**：对 token 用量、延迟与成本完全透明，且不外泄任何源代码。
* **可插拔的 Agent 架构**：模块化运行时，支持 MCP（模型上下文协议）、LSP（语言服务协议）、沙箱化代码执行与多轮工作流。
* **灵活的使用形态**：可作为终端 CLI（maple / mph）、本地 Web UI 或原生桌面窗口（`pnpm desktop:dev`）运行，也可桥接进 Maple VS Code 扩展。

---

## 快速开始

<a id="quick-start"></a>

### 从源码运行

<a id="run-from-source"></a>

```sh
# Clone and enter the directory
git clone https://github.com/AlienBTw/maple-harness.git
cd maple-harness

# Install dependencies and build
pnpm install
pnpm run build

# Start the web UI
pnpm maple web
```

### CLI 用法

```sh
# Run interactive CLI session
pnpm maple

# Run in headless non-interactive mode
pnpm maple "explain this codebase" --headless
```

---

## 许可与致谢

Maple Harness 基于 [MIT License](LICENSE) 许可发布。源自 [Maple Harness](https://github.com/deepseek-ai/deepseek-harness)（c）2026 DeepSeek，依 MIT 许可。详情见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

