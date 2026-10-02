# Agent Note: OS-keychain credentials provider

Status: implemented

English | [中文](2026-09-28-os-keychain-credentials-provider.zh.md)

## Problem

The file-backed credentials provider stores secrets in `$MAPLE_HOME/.credentials.yaml` at `0600`. That stops other OS users, not the model's same-UID bash and filesystem tools. Deployments that must keep provider keys away from their own agent need a store those tools cannot open as an ordinary file. The credential seam already left room for a keyring-backed sibling; [credential boundaries](../architecture/2026-07-30-credential-boundaries-and-atomic-registration.md) recorded shipping it as deferred work.

## Decision

`@maple/credentials-keychain` beside `credentials-local` implements `CredentialProvider` against the host OS keychain through `@napi-rs/keyring` (maintained napi-rs binding over keyring-rs: macOS Keychain, Windows Credential Manager, Linux Secret Service). Config selects the store backend: `os` for production, `memory` for tests and CI. Suites may also pass a programmatic `store` (`KeychainBackend`) so coverage never needs a real keychain. Resolution keeps the same environment layering as the file provider (`env` > keychain > `.env` fallbacks); only the managed store moves off disk. Records live as JSON under `#record/<scope>/<id>` with a durable `#index/records` list because the binding has no list-credentials API.

`@maple/credentials-local` remains the default in `maple-base`. Opting into the keychain provider is a composition swap of the `credentials` row; both packages stay available and must not mount together.

## Alternatives considered

**Ship keytar.** Rejected: upstream is archived; `@napi-rs/keyring` is maintained and covers the same three OS stores.

**Replace the file provider as the default.** Rejected: headless CI and simple deployments still want a file document without a desktop keychain; the stronger boundary is optional.

**Fold both backends into one package with Config selecting file vs keychain.** Rejected: each backend owns different failure modes, permissions, and dependencies; a sibling package keeps the file provider's surface and optional native dependency isolated.

**Require a real OS keychain in unit tests.** Rejected: CI hosts and sandboxes often lack an unlocked Secret Service; an injectable `KeychainBackend` plus `backend: memory` give 100% coverage without that dependency.

## Consequences

Capability catalogs list both providers. Package tests cover reference and record paths, shadowing, dispose races, corrupt payloads, and the OS adapter through a fake Entry factory. Cross-process record read-modify-write has no harness-wide lock (last-write-wins), matching the documented limit on the file provider's same-reference concurrent writes.
