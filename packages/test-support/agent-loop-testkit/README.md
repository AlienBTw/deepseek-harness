# `@maple/agent-loop-testkit`

English | [中文](README.zh.md)

Shared helpers for tests that exercise the concrete `AgentLoop`:

- `mountAgentLoopTestDependencies(ctx, options?)` installs the LLM, session, system-prompt, tool, and agent services in dependency order, then returns before the loop is mounted.
- `waitForIdle` / `waitForStatus` / `waitForSessionEvent` wait on `agent/status` and `session/event` publications instead of wall-clock `setTimeout` sleeps.
- `assertDeriveMessagesReplay` / `withDeriveMessagesReplay` / `SessionReplayTracker` re-seed a fresh `Session` from the live log and assert `deriveMessages()` equality (the session replay invariant).

The caller registers adapters and optional plugins, mounts `AgentLoop` with the configuration under test, and disposes its own Context. System-prompt and tool-registry configuration can be forwarded through `options`; the helper does not provide test defaults beyond those owned by the services. A plugin-load failure rejects the helper call, while services activated earlier in the sequence remain owned by the caller's Context.

```ts
import { Context } from '@maple/cordis'
import AgentLoop from '@maple/agent-loop'
import {
  assertDeriveMessagesReplay,
  mountAgentLoopTestDependencies,
  waitForIdle,
} from '@maple/agent-loop-testkit'

const ctx = new Context()

await mountAgentLoopTestDependencies(ctx)
// Register the test adapter and any optional plugins here.
await ctx.plugin(AgentLoop, { agents: [] })
const agent = ctx.agentLoop.create(/* ... */)
// send work, then:
await waitForIdle(ctx, agent)
assertDeriveMessagesReplay(ctx, agent.session)
```

Tests of injection failures, partial topology, service load order, or service teardown mount their dependencies directly instead of using this helper. `pnpm run verify-no-settimeout-in-tests` bans new `setTimeout` uses under `packages/*/*/tests` outside the migration allowlist in `scripts/settimeout-test-allowlist.json`.

## Model Experience

None, as this test-only composition helper neither drives nor modifies model requests.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Only the mandatory prerequisite spine is shared** — adapters, optional plugins, `AgentLoop`, agents, and Context teardown remain caller-owned so scenario-specific ordering stays visible.
- **Replay fixture adoption is incremental** — helpers are available package-wide; agent-loop specs adopt them first, and remaining suites migrate as `setTimeout` allowlist entries shrink.
