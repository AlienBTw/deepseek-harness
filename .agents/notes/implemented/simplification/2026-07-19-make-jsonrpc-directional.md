# Agent Note: Make JSON-RPC completion and transport directional

Status: implemented

English | [中文](2026-07-19-make-jsonrpc-directional.zh.md)

## Problem

The JSON-RPC bridge modeled both endpoints as symmetric peers although the shipped protocol is directional. The shared transport (now `@maple/sdk-protocol`, used by the server and by the TypeScript SDK client) implemented two halves no endpoint uses: server-originated requests and client-originated notifications. The Python SDK sent requests and received responses or notifications, but also queued unused inbound server requests and exposed response helpers.

`session/prompt` also reported one settled turn through two protocol shapes. The server emitted `session.finished` and then returned the constant `{ accepted: true }`; the Python SDK discarded that response and waited for the notification to recover the status. Because the response is written only after the handler returns, the notification necessarily preceded the constant response on the same stream.

The unused halves added pending-request maps, generated IDs, request queues, close-time rejection paths, response helpers, and a second completion waiter without serving a production caller.

## Decision

`session/prompt` returns the settled outcome directly as `{ messageId, status, reason }` after `agent.whenIdle()`. `status` is `ok` | `error` | `aborted` (deployment-mapped from the captured `TurnEndReason`); reaching idle without a `turn/end` remains an invariant error. There is no `session.finished` notification and no constant `{ accepted: true }` response. `session.event`, `session.status`, `subagent.started`, and `subagent.finished` still stream before the response when emitted during the awaited handler, and durable session events remain the source for final-response reconstruction.

The Python SDK exposes a validated `SessionPromptResponse` from `session_prompt()` and no longer carries `IncomingRequest`, inbound request queues, or client-originated notification / respond helpers. Unexpected server-request frames are ignored by the reader rather than matching a response waiter.

Production call sites already use the directional halves: the server installs `onRequest` and emits `notify`; the TypeScript and Python clients issue `request` and consume inbound notifications.

## Deferred

`JsonRpcLineTransport` remains a bidirectional peer class (`request`, `notify`, `onRequest`, `onNotification` on one type). Protocol tests still exercise a symmetric transport pair. Narrowing or splitting the class into server-side and client-side transports — so each endpoint cannot exercise the unused direction — is unfinished residual work from this decision.

## Alternatives considered

**Keep a generic symmetric JSON-RPC peer for future methods.** Server-initiated requests may eventually support interactive permissions, but no typed method or production consumer exists. The pre-release protocol can add the smallest required direction when that feature is designed instead of carrying an unexercised peer today.

**Keep `session.finished` for streaming clients.** Turn settlement is not incremental data: the request response already marks the same boundary and follows all earlier notifications on the ordered stream. A second terminal notification creates two representations that clients must reconcile.

## Consequences

- Clients read the authoritative prompt outcome from the `session/prompt` response; raw listeners that expected only `session.finished` must move to that response.
- A future server-initiated request requires a new typed protocol addition rather than reusing dormant symmetric transport machinery.
- Same-session overlap rejection, framing, multibyte input, handler errors, flush, shutdown ordering, and final-response reconstruction retain their prior behavior under the settled-response model.
- Until the Deferred transport narrowing lands, unused peer methods remain callable on the shared class even though no production endpoint uses them.
