# Agent Note: SDK session/cancel JSON-RPC method

Status: implemented

English | [中文](2026-09-01-sdk-session-cancel.zh.md)

## Problem

Out-of-process harness clients (TypeScript `@maple/sdk-client`, Python `maple_harness`) could prompt a session but had no wire method to abort an in-flight turn without tearing down the session. Embedders and automation needed the same cancellation semantics the in-process agent exposes through `agent.cancel({ kind: 'user' }, { keepInbox? })`.

## Decision

Add a directional client→server JSON-RPC request `session/cancel` with typed params and result on `@maple/sdk-protocol`, implement it on `HarnessSdkJsonRpcServer`, and expose `client.cancel(sessionId, keepInbox?)` on the TypeScript SDK and `client.session_cancel(session_id, keep_inbox)` on the Python SDK.

The server resolves the live session record, verifies the handle still owns the current agent instance, and delegates to `agent.cancel`. Missing or stale sessions return `{ canceled: false }` without throwing.

## Alternatives considered

**Reuse session/prompt with an abort flag.** Prompt is turn-start semantics; cancel is orthogonal lifecycle control and would conflate two completion paths on one method.

**Server-initiated cancel notification.** No production consumer waits passively; a request/response keeps the directional model and matches client-initiated abort.

## Consequences

SDK clients can stop active work programmatically while optionally retaining queued inbox messages. The method composes with existing session lifecycle; it does not dispose the session or the JSON-RPC connection.

## Verification

- TypeScript: `packages/sdk/server/tests/server.spec.ts` exercises cancel on missing and live sessions; `packages/sdk/client/tests/sdk-client.spec.ts` covers the client wrapper.
- Python: `python/sdk/tests/test_client.py::test_client_session_cancel` covers the wire round-trip.
