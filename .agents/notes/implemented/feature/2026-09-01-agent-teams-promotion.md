# Agent Note: Promote Agent Teams to product packages

Status: implemented

English | [中文](2026-09-01-agent-teams-promotion.zh.md)

## Problem

Agent Teams reached stable service and tool contracts, REAL-composition coverage, and a browser task-board surface, but remained under `packages/experimental/` with `@maple/experimental-*` names. That placement excluded the packages from release families while still forcing every consumer to opt in through examples or bespoke patches, and it blocked the shipped maple-base and standard preset from mounting the host service and scoped tools together with the Web UI.

## Decision

Promote the domain to `packages/agent-team/` as `@maple/agent-team` and `@maple/tool-agent-team`, add `@maple/client-ui-agent-team` for a read-only task-board dock over the new `agentTeam` session projection, and wire all three into maple-base, maple-web-app, and the `standard` agent preset. There are no compatibility aliases: imports, Cordis rows, catalogs, and workspace paths use the promoted names only.

`@maple/agent-team` registers the `agentTeam` projection unit when `sessionProjections` is composed. The fold keeps non-deleted `team/task` snapshots in numeric creation order; deleted tasks drop out of the wire view. `@maple/client-ui-agent-team` renders that projection in `conversation.input.dock` and adds no Remote mutations.

The maple-base bundle mounts `@maple/agent-team` on the host plane. The `standard` preset mounts `@maple/tool-agent-team` in its delegation group. maple-web-app mounts `@maple/client-ui-agent-team`. Misconfigured duplicate scoped tool registration still fails at install time; there is no silent fallback to legacy continuable controls inside Team scopes.

## Alternatives considered

**Keep experimental placement and document a profile patch only.** Rejected: promotion is the stated exit from the [experimental Agent Teams package decision](../architecture/2026-08-18-experimental-agent-teams-packages.md), and the product now needs the service on every shipped host composition.

**Add compatibility re-exports under the old npm names.** Rejected: pre-release policy prefers one correct foundation over alias shims.

**Expose task-board state only through a new Remote namespace.** Rejected for the first promotion cut: the session log already carries `team/task` snapshots, so a projection fold gives the browser the same authoritative read model without another RPC surface.

## Consequences

Agent Teams joins the dsh release family and standard workspace graphs. Examples, generated catalogs, and subsystem docs point at `packages/agent-team/*`. Experimental dependency isolation no longer applies to these packages; release packages may depend on them normally.

The experimental directory keeps only unrelated prototypes. Follow-up work can extend the task-board UI with roster rows or host-side mutations once a Remote or projection contract needs them.

## Verification

- `packages/agent-team/agent-team/tests/loader-composition.spec.ts` boots `@maple/agent-team` and `@maple/tool-agent-team` through Loader and asserts `ctx.agentTeams` plus `team_task_create`.
- `packages/agent-team/agent-team/tests/projection.spec.ts` folds `team/task` create/update/delete into the `agentTeam` projection.
- `packages/client/ui-agent-team/tests/browser-plugin.client.spec.tsx` renders tasks from `useProjection('agentTeam')` and hides an empty board.
