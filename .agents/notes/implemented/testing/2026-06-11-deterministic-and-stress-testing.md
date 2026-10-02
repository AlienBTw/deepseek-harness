# Agent Note: Deterministic tests, the replay invariant fixture, and race stress

Status: implemented

English | [中文](2026-06-11-deterministic-and-stress-testing.zh.md)

## Problem

Several loop tests synchronized with `setTimeout(N)` sleeps — flakiness debt that wastes agent cycles on retries and can mask ordering bugs. Separately, the core architectural promise (any session log replays to identical derived history) was asserted in only a couple of tests even though it is cheap to assert broadly. The inbox wakeup race was verified by hand once; nothing re-verified it continuously.

## Decision

Three foundations ship together:

1. **Event-driven waits, gated sleeps.** `@maple/agent-loop-testkit` exports `waitForIdle`, `waitForStatus`, and `waitForSessionEvent` for `agent/status` and `session/event` publications. Prefer those (or vitest fake timers when time itself is under test) over wall-clock sleeps. `pnpm run verify-no-settimeout-in-tests` scans `packages/*/*/tests/**/*.{ts,tsx}` and fails on any `setTimeout` outside `scripts/settimeout-test-allowlist.json`. Stale allowlist entries fail closed so the list shrinks as files migrate. The gate runs in the static CI / hygiene aggregates.

2. **Universal replay helpers.** The same package exports `assertDeriveMessagesReplay`, `withDeriveMessagesReplay`, and `SessionReplayTracker`: after a test mutates a live session, the helper seeds a fresh `Session` from `[...session.events]` and asserts `deriveMessages()` equality. Agent-loop specs adopt the helpers first (`loop.spec.ts` and the testkit's own coverage); remaining suites migrate incrementally as allowlisted sleeps disappear.

3. **Nightly stress skeleton.** `.github/workflows/test-stress-nightly.yml` (and `pnpm run test:stress:agent-loop`) shuffle the agent-loop and agent suites repeatedly. Vitest 4 has no `--repeats` CLI, so the workflow loops shuffled passes; when the runner gains `--repeats`, replace the loop with a single invocation. Do not add `--retry`: a flake found here is a bug to fix. Raise iteration counts after the suite is sleep-free.

## Consequences

New package tests cannot add unallowlisted `setTimeout` without failing CI. Replay equality is one helper call away, so suites can accumulate hundreds of replay checks without duplicating seed/assert boilerplate. The nightly job is intentionally a skeleton with modest default iterations until sleeps are gone; it documents the no-retry policy now so later stress increases do not reintroduce flake masking. Full suite adoption of the replay fixture and complete allowlist drainage remain follow-on work, not blocked on a second decision.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
