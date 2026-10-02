# @maple/run-budget

English | [中文](README.zh.md)

Optional spend ceilings for one agent driver wake. The plugin never appears as a tool: it watches `agent/status`, `agent/pre-step`, and `agent/request`, and when a configured ceiling would be exceeded it ends the open turn with a durable `{ kind: 'quota', code }` reason instead of a silent `blocked`. Decision record: [the run-budget Agent Note](../../../.agents/notes/implemented/feature/2026-09-28-run-budget-spend-caps.md).

## Config

```yaml
- id: run-budget
  name: '@maple/run-budget'
  config:
    maxTurnsPerRun: 8              # optional; positive safe integer
    maxOutputTokensPerTurn: 8192   # optional; positive safe integer
```

Both fields are optional. Omitting both leaves the plugin inert. A present value that is not a positive safe integer fails at plugin load.

## Enforcement

- **`maxTurnsPerRun`** — counts `turn/start` admissions during one idle→running→idle wake. The first step of turn N+1 rejects with `{ kind: 'quota', code: 'MAX_TURNS' }` after that turn has already opened, so the session log carries a loud quota ending. Tool continuations stay inside the already-admitted turn and do not consume additional budget.
- **`maxOutputTokensPerTurn`** — clamps every conversation-model request's `maxTokens` to the ceiling. An already-stricter agent or waterfall cap is preserved; a higher or absent value is replaced. Hitting the provider output ceiling still records the ordinary `max-tokens` turn ending.

Same-session Goal rounds keep their own `maxGoalRounds` budget in `@maple/goal`; this plugin is the deployment-wide spend fence for ordinary wakes.

## Model Experience

### Quota turn ending

#### What the model sees

No additional prompt text. The turn that exceeded the turn ceiling closes without a model call. Clients and ACP map `MAX_TURNS` to `max_turn_requests` and an output ceiling hit to `max_tokens`.

#### Token effect

Zero tokens for a rejected turn. Clamped `maxTokens` bounds every admitted request.

#### KV Cache effect

None beyond the ordinary turn boundary.

## Known Limitations and Deferred Work

- **No soft USD estimate** — billing rate tables are out of scope; burn UX reads the existing `tokenUsage` projection.
- **No cross-wake accumulation** — each driver wake resets the turn counter; durable session-lifetime budgets remain a separate policy.
