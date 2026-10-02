# Vendor patches

Checked-in unified diffs for local modifications recorded in [../README.md](../README.md). The drift scaffold (`pnpm run verify-vendor-drift`) reconstructs a package from the manifest SHA plus these patches when upstream is reachable, and always validates that indexed patch files exist and that `add-file` patches match the corresponding `vendor/` files.

## Layout

| Path | Role |
|---|---|
| `index.json` | Patch inventory, unpatched log-entry reasons, and the `localAgentJob` command |
| `*.patch` | Unified diffs applied relative to each package root under `vendor/` |

## Local agent job (private upstream)

Most remotes in the manifest (`deepseek-harness/*`) are private mirrors. CI often cannot clone them. On a machine with access to `~/repos/cordis-workspace` (or GitHub credentials for those remotes):

1. Ensure `git` is on `PATH`.
2. Run `pnpm run verify-vendor-drift` (omit `--offline`).
3. When adding a local modification, emit a patch against the pinned SHA, add it to `index.json`, and re-run the check.

`pnpm run verify-vendor-drift --offline` is the always-available gate: it checks the index and add-file patch payloads without contacting upstream.

## Feasible patches checked in here

- Log entry 5: per-package `tsdown.config.ts` files that do not exist upstream (`add-file`).
- Log entry 13: `include` `writeTask` exact-optional typing (`source`).

Wholesale regenerations (package.json, tsconfig) and large multi-file source deltas stay in `unpatchedLogEntries` until a local sync captures them.
