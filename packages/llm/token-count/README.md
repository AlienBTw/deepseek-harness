# @maple/token-count

English | [中文](README.zh.md)

Shared `cl100k_base` token counting through [`js-tiktoken`](https://github.com/dqbd/tiktoken). Used by `@maple/token-meter` for request/surface pressure and by `@maple/context-repo-map` for map budgeting so both surfaces agree on tokenizer-true counts.

| Export | Role |
|---|---|
| `estimateTokensExact(text)` | Full encode; no sampling |
| `tokenCount(text)` | Exact under 200 chars; otherwise Aider-style line sampling then char-ratio scale |

## Model Experience

Not model-facing. Compaction and repo-map consumers own any request-prefix effects.

#### KV Cache effect

No direct invalidation.

## Known Limitations and Deferred Work

- **cl100k_base only** — DeepSeek and other provider tokenizers may diverge; adapter-reported usage remains the preferred anchor when a matching envelope exists.
- **Sampling on long `tokenCount` inputs** — long repo maps trade exactness for budget-search speed; pressure metering uses `estimateTokensExact` on priced fragments.
