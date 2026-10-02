# @maple/token-count

[English](README.md) | 中文

通过 [`js-tiktoken`](https://github.com/dqbd/tiktoken) 共享的 `cl100k_base` token 计数。`@maple/token-meter` 用它计量请求/表面压力，`@maple/context-repo-map` 用它做地图预算，使两侧在 tokenizer 真值计数上一致。

| 导出 | 作用 |
|---|---|
| `estimateTokensExact(text)` | 完整编码；不采样 |
| `tokenCount(text)` | 少于 200 字符时精确；否则按 Aider 风格按行采样再按字符比例外推 |

## Model Experience

不面向模型。压缩与 repo-map 消费方各自拥有任何请求前缀影响。

#### KV Cache effect

无直接失效。

## Known Limitations and Deferred Work

- **仅 cl100k_base** — DeepSeek 与其他提供方分词器可能不同；存在匹配信封时仍优先使用适配器报告的用量锚点。
- **长 `tokenCount` 输入会采样** — 长 repo map 用近似换预算搜索速度；压力计量对计价片段使用 `estimateTokensExact`。
