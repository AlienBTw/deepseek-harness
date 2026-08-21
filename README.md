# ?? Maple Harness

Maple Harness (maple / mph) is an open-source, modular AI agent harness designed for token efficiency, AST repo-mapping, sovereign proxy observability, and seamless developer workflows.

Built on an extensible **everything-is-a-plugin** architecture powered by [Cordis](https://github.com/cordiverse/cordis) and originating from the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) foundation.

---

## ?? Key Capabilities

* **Token-Efficient Context Engine**: Built-in 14-language Tree-Sitter AST repo-mapping with PageRank personalization to keep prompt overhead low (~2k tokens).
* **Sovereign BYOK Proxy Integration**: Complete transparency over token usage, latency, and cost with zero source code exfiltration.
* **Pluggable Agent Architecture**: Modular runtime supporting MCP (Model Context Protocol), LSP (Language Server Protocol), sandboxed code execution, and multi-turn workflows.
* **Flexible Interfaces**: Run as a standalone terminal CLI (maple / mph), a local Web UI, or bridged into the Mapl VS Code extension.

---

## ?? Quick Start

### Run from Source

`sh
# Clone and enter the directory
git clone https://github.com/AlienBTw/maple-harness.git
cd maple-harness

# Install dependencies and build
pnpm install
pnpm run build

# Start the web UI
pnpm maple web
`

### CLI Usage

`sh
# Run interactive CLI session
pnpm maple

# Run in headless non-interactive mode
pnpm maple "explain this codebase" --headless
`

---

## ?? License & Attribution

Maple Harness is licensed under the [MIT License](LICENSE).
Originates from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (c) 2026 DeepSeek under the MIT License. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.
