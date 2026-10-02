# Agent Note: Supply chain checks and vendor drift verification

Status: implemented

English | [中文](2026-06-11-supply-chain-and-vendor-drift.zh.md)

## Problem

The vendor manifest ([the vendoring decision](2026-06-11-vendor-cordis-as-source.md)) is enforced at commit time in the *forward* direction (vendored change ⇒ manifest update) but nothing verified the manifest's *claims*: that `vendor/` equals upstream-at-SHA plus exactly the logged modifications. Ordinary npm dependencies also lacked advisory monitoring on a schedule.

## Decision

Ship three complementary checks:

1. **License inventory** — `pnpm run verify-vendored-licenses` asserts every vendored package carries a `LICENSE` file and that each `package.json` `license` matches the [license inventory](../../../../vendor/README.md#license-inventory) table in `vendor/README.md`. The check runs in the `hygiene` and CI static aggregates.
2. **Dependency advisories** — `pnpm run audit:deps` runs `pnpm audit --audit-level high` against the lockfile. `.github/workflows/supply-chain.yml` runs it on a nightly schedule, on lockfile-touching pushes/PRs, and on vendor-patch script changes.
3. **Vendor drift scaffold** — `pnpm run verify-vendor-drift` reconstructs packages from manifest SHAs plus checked-in diffs under `vendor/patches/` when upstream is reachable. `pnpm run verify-vendor-drift:offline` (hygiene / CI static / supply-chain workflow) validates the patch index and that `add-file` patches match on-disk files. Feasible patches for log entries 5 and 13 are checked in; wholesale regenerations and large multi-file deltas stay listed in `vendor/patches/index.json#unpatchedLogEntries` until a local sync captures them.

Private upstream mirrors often block CI clones. The documented local agent job is `pnpm run verify-vendor-drift` from a machine with cordis-workspace credentials ([vendor/patches/README.md](../../../../vendor/patches/README.md)).

Renovate (or a scheduled agent proposing small npm update PRs) remains deferred; Dependabot already covers npm/uv/actions on a cron, and vendored packages stay excluded from registry updates.

## Alternatives considered

- **`pnpm audit` instead of osv-scanner** — either satisfies advisory scanning; this landing uses `pnpm audit` because it is already available through the pinned package manager with no extra binary.
- **A scheduled agent task instead of Renovate** — still open for proposing dependency bumps; Dependabot supplies the interim cadence, and vendored packages remain on the manifest sync procedure either way.
- **Fail CI hard when every upstream clone is blocked** — rejected for the offline scaffold era: private remotes would paint the supply-chain workflow red without proving drift. Blocked clones report the local agent job and exit successfully after the patch-index check; unexplained diffs after a successful clone still fail.

## Consequences

- Missing vendored `LICENSE` files or inventory mismatches fail hygiene and CI static before merge.
- High-severity lockfile advisories surface on schedule and on lockfile PRs without blocking unrelated documentation changes.
- Patch-covered local modifications are verifiable artifacts; the remaining log entries still need patch capture during ordinary upstream syncs.
- Full SHA+patch reconstruction stays a credentialed local (or future token-backed CI) job until private remotes are available to the runners.
