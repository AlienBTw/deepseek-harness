# @maple/context-repo-map

English | [中文](README.zh.md)

Proactive repository-map context: a Tree-Sitter AST repo map with PageRank personalization, injected into agent prompts so the model starts every session already oriented in the codebase. The engine is a faithful port of Aider's `repomap.py` ranking phase (tags → reference multigraph → personalized PageRank → token-budgeted tree rendering).

The plugin mounts through agent presets (`config/agent-presets/*/agent.cordis.yml`); it injects `agents`, walks the session workspace on the first step of a turn, and registers one prompt section per agent.

## Model Experience

### Proactive first-turn repository map

#### What the model sees

One prompt section listing the files most relevant to the workspace, ranked by personalized PageRank over the symbol reference graph. Each ranked file renders its defining symbols as an indented outline; uninteresting line runs collapse behind an ellipsis line, and chat files are omitted entirely (they are already in context). Files with no extractable tags appear as bare path lines ordered by node rank.

##### Rendered section

```markdown
<path/to/file.ts>
  function buildGraph(input: BuildGraphInput): BuildGraphOutput
  function runPageRank(input: RunPageRankInput): RunPageRankOutput
path/to/other.py
src/README.md
```

#### Token effect

The rendered map targets `maxMapTokens` (default 2,000) via binary search over the ranked-tag prefix, so the section's cost is bounded rather than proportional to repository size. Grammar extraction and graph construction happen before prompting; only the final text enters the request.

#### KV Cache effect

The section is computed once per turn start from the same snapshot, so its bytes are stable across steps within the turn and append after the reusable request prefix without invalidating it. A changed workspace (new or removed files) re-renders on the next turn and shifts content at that boundary.

## Known Limitations and Deferred Work

- **Token counts use a chars/4 sampling heuristic** — accurate within ~15% for typical code and English but not byte-exact; swap `estimateTokensExact` for a real BPE tokenizer (js-tiktoken) if budgeting demands it.
- **Grammar coverage is fixed at build time** — the shipped `tree-sitter-wasms` set bounds the supported languages; files in unsupported languages fall back to bare-line rendering via `renderBareLois`.
- **Mentioned-ident boosting is partial** — the port skips Aider's path-component personalization matching and applies mentioned identifiers through the ×10 edge multiplier instead.
