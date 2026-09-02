# Agent Note: Task Surface for structured session interaction

Status: implemented

English | [中文](2026-08-04-task-surface.zh.md)

## Problem

Some tasks need one structured interaction — comparing options, reviewing a table, or filling related fields — instead of alternating prose messages. Without a bounded contract, agents either ship product-specific panels or generate executable Client Plugin code, both with the wrong ownership and lifecycle cost.

## Decision

Ship **Task Surface** as a versioned declarative model (`TaskSurfaceModelV1`) rendered by a static Web Client Plugin. One model-facing tool, `show_task_surface`, publishes the panel, ends the current turn, and waits for a Host-validated submission. The durable artifact is the user's submitted conclusion as an ordinary visible user message, not the panel chrome.

Packages:

| Package | Role |
|---|---|
| `@maple/task-surface` | Parser, limits, projection fold, `task-surface/dismissed`, and Host `taskSurface` service (`getActive`, `submit`, `dismiss`) |
| `@maple/tool-task-surface` | `show_task_surface` with presentation metadata and `concludeTurn()` |
| `@maple/client-ui-task-surface` | `conversation.input.dock` Task Surface panel and Remote-backed submit face |
| `@maple/host/apiproxy` | `taskSurface.getActive`, `taskSurface.submit`, `taskSurface.dismiss` RPC |

`maple-base` mounts `@maple/task-surface`; the `standard` preset mounts `@maple/tool-task-surface`; `maple-web-app` mounts `@maple/client-ui-task-surface`. One open Surface per session; duplicate opens, nested calls, and submit while pending fail loud.

## Alternatives considered

**Product-specific triggers per task shape.** Rejected: one admitted component vocabulary and explicit `show_task_surface` calls scale without release coupling.

**Generated HTML/JS in the tool payload.** Rejected: that is Client Plugin authority without the plugin lifecycle.

**Extend `ask_user_question` for large forms.** Rejected: ask blocks mid-turn; Task Surface ends the turn and may stay open across refresh until submit or dismiss.

## Consequences

Structured UI is replayable from `presentationMeta` on `tool/result` plus the `taskSurface` projection. Queue restrictions and branded correlation ids apply at the apiproxy seam. v1 omits conditional fields, uploads, and client-side fetching; new block kinds are protocol changes with parser, renderer, and snapshot coverage.

## Verification

- `packages/task-surface/task-surface/tests/` — parser, projection, service submit/dismiss, loader composition.
- `packages/task-surface/tool-task-surface/tests/` — tool registration and invariant companion.
- `packages/client/ui-task-surface/tests/browser-plugin.client.spec.tsx` — dock registration and Remote verb forwarding.
- `apps/web/tests/task-surface.e2e.ts` — keyless seeded composition shows the dock over a logged `show_task_surface` result.
