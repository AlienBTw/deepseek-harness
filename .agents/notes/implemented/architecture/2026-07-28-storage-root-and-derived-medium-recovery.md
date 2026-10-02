# Agent Note: Storage root placement and derived-medium recovery

Status: implemented

English | [中文](2026-07-28-storage-root-and-derived-medium-recovery.zh.md)

## Problem

The persisted projection cache ([note](../../proposed/architecture/2026-07-27-session-projection-and-command-log.md), shipped as `dsh-session-projection-cache`) surfaced two gaps in the storage substrate it landed on. Both are properties of the domain-KV stack ([design](2026-07-24-domain-kv-storage-and-workspace.md)), not of the cache itself, and both bite the cache first because it is the first *derived* medium on that stack.

**Where the files actually live.** The shared base defaults the session store to the global harness home (`$DSH_HOME/sessions`, default `~/.dsh/sessions`), while the shipped Web overlay used to give the json backend the relative root `./.storages`: `workspace.json` and `session_projcache.json` landed under `<launch dir>/.storages/` — two launches from different directories shared their sessions yet saw different workspace registries and different projection caches. Even after the overlay anchors an absolute global root, `JsonStorageBackend` still joined a relative root against `process.cwd()` at each open — the exact hazard the JSONL session backend prevents by resolving once at construction.

**How recovery worked before.** Inside a healthy medium the cache is fully self-healing by design. But at the *medium* level there was no recovery at all: a truncated, hand-edited, or version-bumped `session_projcache.json` failed `openJsonUnit` with `malformed-medium`/`version-mismatch`, a schema-drifted record failed domain open with `invalid-record`, and under the CLI's fail-loud boot the assembly refused to start. A file whose entire content is rebuildable from session logs could brick boot. The same fail-loud path is *correct* for `workspace.json` — workspace records are authoritative, not derivable — so the missing concept is a per-domain declaration of authority.

## Decision

Two independent changes, one per gap.

### One global storage root; resolved once at construction

- The Web overlay anchors `storage-json.root` to `$DSH_HOME/storages` through `dshHomePath('storages')` (default `~/.dsh/storages`, beside sessions).
- `JsonStorageBackend` resolves its configured root once at construction so a later `process.cwd()` change cannot split one backend across roots. The SQLite storage backend already resolves its path.
- Pre-release stance: no migration shim. Deployments that cached under `<cwd>/.storages` re-derive or move the files once.

### Declared derived media: reset instead of reject

- `DomainSpec` gains `recovery?: 'reject' | 'reset'` (default `'reject'`). The spec object is already the source of a domain's identity and layout; whether its medium is authoritative or derived is the same kind of fact. `session_projcache` declares `'reset'`; `workspace` stays on the default.
- `KvFacet` gains `destroy(descriptor): Promise<void>` — remove the unit's medium entirely (json: delete the file; sqlite: drop the unit's tables). Like `open`, it is a backend storage primitive, not policy; the facility's declared-reset path is the sole caller.
- `DomainFacility.open`, when a spec declares `'reset'` and open fails with exactly a damage-class error — `StorageError('version-mismatch' | 'malformed-medium')` or `DomainError('invalid-record')` — logs one warning naming the domain and the discarded medium, calls `destroy`, and opens again empty once. Every other failure stays loud regardless of the declaration. The retry is single-shot — a second failure propagates without another destroy.
- Bumping the cache domain `version` (or letting zod reject drifted rows) now genuinely discards the whole medium; the cache rebuilds through its normal write points and cold reads — the recovery ladder's outermost rung.

## Alternatives considered

**Keep per-launch-directory `.storages`.** Rejected: sessions are global, so every derived-from-sessions medium splits against its own source of truth.

**Launcher patch + a `storageRoot` profile key.** Not taken: one `!!js` yml expression reaches the global root with the same layering the session root already has.

**Cache-plugin-local recovery.** Rejected: the facility is the one place that already classifies open failures.

**Fall back to an ephemeral in-memory domain on damage.** Rejected: silently degrades and never heals the file.

**Rename the damaged medium aside instead of deleting.** Not chosen for derived media: damaged bytes have no recovery value; delete is honest. Rename-aside remains right for a future authoritative domain that wants reset semantics — which is why `recovery` is per-spec.

**A blanket auto-reset for every domain.** Rejected: `workspace.json` is authoritative user data.

## Consequences

- `dsh` launched from any directory reads and writes the same `$DSH_HOME/storages/*.json` (default `~/.dsh/storages`); relative roots resolve once at construction so later cwd changes cannot split one backend across roots.
- Damage to `session_projcache.json` (truncate, version bump, or schema drift) no longer bricks boot: one warning names the discarded medium, the file disappears, and the cache rebuilds through normal operation.
- The same damage on `workspace.json` still fails loud and refuses to start.
- Auto-delete fires only on the closed damage-class list (`version-mismatch`, `malformed-medium`, `invalid-record`); I/O and misconfiguration stay loud; single-shot retry bounds blast radius to at most one delete per open.
- Facility and backend tests pin reset vs reject, non-damage loud paths, single-shot retry, `destroy` on both shipped backends, and cwd-stable json roots.

## Verification

- `packages/storage/storage-domain/tests/domain.spec.ts` — reset vs reject, non-damage loud, single-shot retry.
- `packages/storage/storage/tests/contract.ts` and json/sqlite specializations — `destroy` on both backends; json root stable across cwd changes.
