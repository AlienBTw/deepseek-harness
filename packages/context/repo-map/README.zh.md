# @maple/context-repo-map

[English](README.md) | 中文

主动式仓库映射上下文：带 PageRank 个性化的 Tree-Sitter AST 仓库映射，注入 agent 提示，让模型在每次会话开始时就已经熟悉代码库。引擎是对 Aider `repomap.py` 排名阶段（tags → 引用多重图 → 个性化 PageRank → 按 token 预算裁剪的树渲染）的忠实移植。

插件经 agent 预设挂载（`config/agent-presets/*/agent.cordis.yml`）；它注入 `agents`，在回合的第一步遍历会话工作区，并为每个 agent 注册一个提示小节。

## 模型体验

### 主动的首轮仓库映射

#### 模型看到的内容

一个提示小节列出与工作区最相关的文件，按符号引用图上的个性化 PageRank 排序。每个入选文件把其定义符号渲染成缩进大纲；无趣的行区间折叠成省略行；聊天文件整体省略（它们已在上下文中）。没有可提取标签的文件按节点秩以纯路径行出现。

##### 渲染段落

```markdown
<path/to/file.ts>
  function buildGraph(input: BuildGraphInput): BuildGraphOutput
  function runPageRank(input: RunPageRankInput): RunPageRankOutput
path/to/other.py
src/README.md
```

#### Token 影响

渲染后的映射通过在排名标签前缀上二分搜索来逼近 `maxMapTokens`（默认 2,000），因此该小节的开销是有界的，不随仓库规模成比例增长。语法抽取与图构建都发生在提示之前；只有最终文本进入请求。

#### KV 缓存影响

该小节每回合开始时从同一快照计算一次，因此其字节在回合内的各步之间稳定，并追加在可复用的请求前缀之后而不使其失效。工作区变化（新增或删除文件）会在下一回合重新渲染，并在那个边界移动内容。

## 已知限制与延期工作

- **token 计数使用 chars/4 的采样启发式**——对典型代码与英文误差约 15% 以内但并非逐字节精确；若预算要求精确，可换用真实 BPE 分词器（js-tiktoken）替换 `estimateTokensExact`。
- **语法覆盖在构建期固定**——随包发布的 `tree-sitter-wasms` 集合决定了支持的语言；不受支持语言的文件经 `renderBareLois` 回退为裸行渲染。
- **提及标识符的加权是部分的**——本移植跳过了 Aider 的路径组件个性化匹配，改用 ×10 边乘子来应用被提及的标识符。

