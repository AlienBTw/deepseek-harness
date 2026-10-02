# dsh-credentials-keychain

English | [中文](README.zh.md)

OS-keychain [credentials](../credentials/README.md) provider: secrets live in the host keychain rather than in a file the model's same-UID tools can read.

| Layer | Source id | Writable | Wins |
|---|---|---|---|
| Inherited process environment | `env` | no | always |
| OS keychain (`Config.service`) | `keychain` | yes (`set`/`unset`) | over both `.env` layers |
| `<invocation cwd>/.env` | `project-env` | not here | over the user `.env` |
| `$MAPLE_HOME/.env` | `user-env` | not here | otherwise |

Environment semantics match [`dsh-credentials-local`](../credentials-local/README.md): a per-run override stays read-only and visible, and a key stored through the Models page replaces `.env` fallbacks as the effective source. The managed store is the OS keychain (macOS Keychain, Windows Credential Manager, or Linux Secret Service) via [`@napi-rs/keyring`](https://www.npmjs.com/package/@napi-rs/keyring) — a store the agent's filesystem and shell tools cannot open as an ordinary file.

The file-backed provider remains the default in [`maple-base`](../../bundle/base/README.md). Deployments that need the stronger boundary swap the `credentials` row to this package; both providers implement the same `ctx.credentials` seam and are never mounted together.

## Config

| Field | Default | Meaning |
|---|---|---|
| `service` | `maple-harness` | Keychain service name shared by every account this provider owns. |
| `backend` | `os` | `os` talks to the host keychain; `memory` is an in-process Map for tests and CI. |

Programmatic boots may also pass `store` (a `KeychainBackend`) to inject a mock without selecting `memory`; YAML compositions cannot set it.

## Composition

Keep `@maple/credentials-local` unless you need the keychain boundary. To opt in, depend on this package and replace the credentials row:

```yaml
- id: credentials
  name: '@maple/credentials-keychain'
  config:
    service: maple-harness
    backend: os
```

## Storage layout

Under `Config.service`:

| Account | Contents |
|---|---|
| `<CredentialRef>` | reference secret string |
| `#record/<scope>/<id>` | JSON `CredentialRecord` |
| `#index/records` | JSON array of stored `CredentialKey` values |

Empty stored values are absent, per the seam rule. Record writes go through `modifyRecord` only; the index is updated with each commit and healed when an indexed account has vanished.

## Security boundary

Unlike the file provider's `0600` document — which stops other OS users but not same-UID agent tools — the keychain is an OS credential store. Tool processes do not receive a path they can `cat`, and ordinary workspace filesystem policy never grants keychain access. Inherited environment values still resolve as today; only the provider-managed store moves off disk.

## Model Experience

Indirectly, through the consuming LLM adapters: stored values authorize their provider requests, and the adapter owns every model-visible surface.

#### KV Cache effect

No direct invalidation; credentials never enter a request prefix.

## Known Limitations and Deferred Work

- **Same-reference concurrent writes are last-write-wins** — one process serializes its own writers; the OS entry replace is atomic per account, but cross-process record read-modify-write has no harness-wide lock.
- **Record enumeration needs the durable index** — `@napi-rs/keyring` has no list-credentials API; the `#index/records` account is the authority, healed when an account is missing.
- **Environment changes are invisible** — the launch snapshot is frozen; changing an environment-sourced credential takes a restart.
- **Linux Secret Service may prompt** — a locked keyring can block or fail a get/set until the session unlocks it.
