# Agent Note: Local Ollama provider with server-stated capabilities

Status: implemented

English | [中文](2026-08-22-local-ollama-provider-and-real-capabilities.zh.md)

## Problem

Local model serving was reachable only by hand-declaring every model: ids, capacities, and wire protocol typed into settings, all stale the moment a model was pulled or removed. Hardcoding default capacity numbers instead would fabricate facts — Ollama's actual context depends on which model variant was pulled and how it is served, so any constant is wrong for someone.

## Decision

`@deepseek-ai/dsh-llm-pi-ai` registers `ollama` as a catalog provider with three identity-only bootstrap entries (`llama3.2`, `qwen2.5-coder`, `deepseek-r1`) speaking `openai-completions` against `http://127.0.0.1:11434/v1`. The entries carry no context window or output cap: route materialization fills its configurable defaults, so nothing invented ships.

Model discovery treats `ollama` specially in three ways:

- It is exempt from the catalog short-circuit, because its served models depend on what was pulled locally.
- Interrogation probes OpenAI-shaped `GET /models` first, then the native `GET /api/tags`; the native shape is requested only when the provider is `ollama`, so generic gateways never receive sibling-path requests carrying their credentials.
- `/api/tags` carries identities but no capacity facts, so each discovered id is asked directly through `POST /api/show`: the reply's architecture-prefixed `*.context_length` value becomes that model's context window. A failed show call degrades silently — the listing survives, the model stays unnamed-capacity.

## Alternatives considered

**Why not ship corrected static defaults?** Any number is wrong for some pull: variants differ per tag, and the server can serve a model far below its trained maximum. Static values would also go stale exactly when discovery could have been right.

**Why not parse `num_ctx` from `/api/show`'s parameters string?** That field lists only non-default overrides, so its absence is indistinguishable from "default unknown", and the default varies by server version. The architecture-prefixed context length is the one stated fact.

**Why not add a Tauri-side or UI-side Ollama client?** Discovery belongs to the adapter that owns provider vocabulary; a second client would split credential handling and error codes across surfaces.

## Consequences

An unconfigured ollama route resolves and serves, but until discovery runs, its bootstrap entries size from route defaults rather than truth. `POST /api/show` costs one request per discovered model per fetch action — local-only traffic, sequential, and bounded by the listing. The negative guarantee is deliberate: this package never states an Ollama capacity the running server did not state first.
