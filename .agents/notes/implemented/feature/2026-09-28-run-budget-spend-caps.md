# Agent Note: Run-budget spend caps and burn UX

Status: implemented

English | [中文](2026-09-28-run-budget-spend-caps.zh.md)

## Problem

Deployments need optional ceilings on how many turns one driver wake may open and how many output tokens each conversation request may ask for. Without a loud stop reason, a pre-step veto looks like an ordinary policy block, and clients cannot map the ending to ACP `max_turn_requests` / `max_tokens`. Users also need the existing `tokenUsage` and `contextPressure` projections surfaced as burn and occupancy in the Web composer strip; the interactive CLI TUI is gone, so that strip is the product home.

## Decision

`@maple/run-budget` in `packages/guard/run-budget/` is a Config-driven guard. Optional `maxTurnsPerRun` and `maxOutputTokensPerTurn` are positive safe integers validated at load. Omitting both leaves the plugin inert.

Turn accounting keys a WeakMap by the live `Agent` and resets on each idle→running wake. The first step of turn N+1 rejects with `{ kind: 'quota', code: 'MAX_TURNS' }` after `turn/start` has already opened, so the durable log carries a quota ending. Output ceilings clamp `agent/request`'s `maxTokens`, preserving any already-stricter value. `TurnEndReasonMap` gains `quota`, `PreStepDecision` reject may carry a reason, and ACP maps `MAX_TURNS` to `max_turn_requests`.

The Web `StatsLine` adds a burn total (billed input + output) and a compact context-pressure percent beside the existing token groups; `ContextMeter` remains the primary occupancy ring.

Same-session Goal rounds keep `maxGoalRounds` in `@maple/goal`; this plugin is the deployment-wide fence for ordinary wakes.

## Alternatives considered

**Put the ceilings only on `AgentOptions` / agent-loop Config.** Rejected as the sole home because deployments already compose loop-hygiene guards for policy that should not require per-agent option plumbing; agent `maxTokens` remains the per-agent seed the guard may further clamp.

**Reject with `{ kind: 'blocked' }`.** Rejected because clients and ACP cannot distinguish a spend ceiling from an ordinary prompt veto.

**Accumulate turns across wakes or soft USD estimates.** Rejected for this slice: cross-wake budgets and rate tables need product owners and are deferred.

## Consequences

Base and example assemblies may mount `@maple/run-budget` with empty Config. Exceeding the turn ceiling ends the open turn without a model call. Package tests cover fail-loud Config, the two-turn quota ending, and output clamping. A keyless ACP snapshot for the stop reason remains desirable follow-up evidence when a multi-turn ACP scenario is cheap to script.
