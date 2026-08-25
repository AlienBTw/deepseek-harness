# Agent Note: Repo-map plugin face, tag-less-file filter, and companion gate conformance

Status: implemented

English | [中文](2026-08-24-repo-map-plugin-face-and-graph-filter.zh.md)

## Problem

The repo-map context provider shipped with defects its own gates should have caught. The plugin mixed named exports with `export default`, so the Loader's `unwrapExports` kept only the default object and discarded the namespace — including `inject: ['agents']` — reproducing the documented ACP default-export failure class. The tag-less-file filter tested membership against `` definitions.has(`${file}\u0000`) ``, a key form the map never stores (its keys are `` `${rel_fname}\u0000${name}` ``), so the filter degenerated to a no-op and files that owned definitions but earned no rank could render as duplicate bare sentinels. The package also had no invariant companion, manifest export, or project reference, violating the every-package-owns-`./invariant` rule, and its tests never exercised the plugin through a real Loader composition.

## Decision

Repo-map now follows the function-plugin face used by every sibling context provider: named exports only (`name`, `inject`, `Config`, `apply`) and no default export, so the Loader retains the full namespace including the injected service.

`buildRankedTags` derives the set of definition-owning files by taking each definition key's prefix before the NUL separator. A file qualifies as tag-less only when it owns no definition entry and has not already appeared through ranked tags; malformed keys without a separator name no owning file. The behavior matches Aider's repomap ranking phase the port mirrors.

The package ships a hand-owned `src/invariant.ts` companion registering under its own package name. It validates every durable repo-map reading: exactly one text block, the package-owned header line, a snapshot source whose section text equals the message body and nothing more, and an append inside an open turn. Validation runs at dispatch, at session creation for seeded history, and across already-stored sessions when the companion installs. The manifest publishes `./invariant`, declares `@maple/invariants` as peer and dev dependency, and the package tsconfig references the invariants runtime.

Composition coverage boots the plugin from a test-only cordis.yml through the real Loader + Include path over a fixture workspace parsed by the real Tree-Sitter grammars, asserting the durable first-step injection, per-turn re-injection, quiet later steps, and disposal.

## Alternatives considered

**Keep the default export and add `inject` to it.** Rejected because the Loader discards the namespace whenever a default exists, so any named-export metadata is unreliable there; the postmortem behind packages/AGENTS.md already ruled the mixed face out.

**Fix the filter by probing `definitions.get()` per file inside the loop.** Rejected because it rescans every key per file; deriving one prefix set is linear and keeps the sentinel path allocation-free.

**Leave graph.ts below the coverage gate as pre-existing debt.** Rejected for the arms adjacent to this fix: the personalization cap, def-only self-edge, and separator-prefix derivation are the exact behavior the filter depends on, so they are pinned directly; the remaining untouched helper branches stay as recorded debt.

## Verification

Unit tests pin the corrected filter: ranked-def files never double-render as sentinels, unranked definition owners stay out of the sentinel set, chat files keep their sentinels suppressed, ordering follows node rank, and separator-less keys claim no file. Invariant tests cover each rejection arm plus foreign-source bypass and install-time validation. The composition suite covers the Loader face, first-step injection, per-turn re-injection, and fiber disposal. `verify-package-invariants` accepts all companions.

## Consequences

The model sees the same repository-map text as before on well-formed workspaces; the visible change is confined to workspaces where unranked definition owners previously rendered as duplicated sentinels. Any future change that reintroduces a default export or breaks the snapshot contract fails in tests rather than silently dropping injection. The package remains below the per-file 100% branch gate in `tree-context.ts`, `parser.ts`, and `queries.ts` — pre-existing gaps unrelated to this fix that CI's coverage lane will still flag until separately addressed.
