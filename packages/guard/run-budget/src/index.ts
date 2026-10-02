/**
 * Optional spend caps for one agent driver wake: a maximum number of turns
 * and/or a maximum conversation-model output-token ceiling per request.
 * Misconfiguration fails at plugin load; an exceeded ceiling ends the open
 * turn with `{ kind: 'quota', code }` rather than a silent block.
 * @module @maple/run-budget
 */

import type { Context } from '@maple/cordis'
import z from '@maple/schemastery'
import type { Agent, PreStepDecision } from '@maple/agent'
import type { LlmCallConfig } from '@maple/llm'

export const name = 'run-budget'

/**
 * Deployment-varying spend ceilings. Every field is optional; omitting both
 * leaves the plugin inert. A present value must be a positive safe integer —
 * zero, fractions, and non-integers fail at load, never at the first turn.
 */
export interface Config {
  /**
   * Maximum `turn/start` events admitted during one driver wake (idle →
   * running → idle). The (N+1)th turn opens, then its first pre-step rejects
   * with `{ kind: 'quota', code: 'MAX_TURNS' }`.
   */
  maxTurnsPerRun?: number
  /**
   * Positive output-token ceiling applied to every conversation-model request
   * in the deployment. Existing lower caps are preserved; a higher or absent
   * `maxTokens` is clamped to this value.
   */
  maxOutputTokensPerTurn?: number
}

export const Config: z<Config> = z.object({
  maxTurnsPerRun: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  maxOutputTokensPerTurn: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
})

/** Per-wake turn counter for one live agent. */
interface RunState {
  /** Turns whose `turn/start` this wake has already admitted. */
  turnsStarted: number
}

/**
 * Fail loud on values schemastery admitted but that violate the positive
 * safe-integer contract (NaN, non-integers past a loose parse, etc.).
 * @param label - config field name for the error text.
 * @param value - optional configured ceiling.
 * @returns the validated positive safe integer, or `undefined` when omitted.
 */
function optionalPositiveSafeInteger(label: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`run-budget: ${label} must be a positive safe integer`)
  }
  return value
}

/**
 * Install the spend-cap listeners.
 * @param ctx - plugin context; listeners dispose with it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const maxTurnsPerRun = optionalPositiveSafeInteger('maxTurnsPerRun', config.maxTurnsPerRun)
  const maxOutputTokensPerTurn = optionalPositiveSafeInteger(
    'maxOutputTokensPerTurn',
    config.maxOutputTokensPerTurn,
  )
  if (maxTurnsPerRun === undefined && maxOutputTokensPerTurn === undefined) return

  const runs = new WeakMap<Agent, RunState>()

  // A fresh wake starts a fresh budget. Idle clears the counter so a later
  // human prompt is not charged for earlier completed work.
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'running') runs.set(agent, { turnsStarted: 0 })
    else runs.delete(agent)
  })

  if (maxTurnsPerRun !== undefined) {
    const ceiling = maxTurnsPerRun
    ctx.on('agent/pre-step', async ({ agent, step }, next): Promise<PreStepDecision> => {
      // Only the first step of a turn charges the turn budget; tool
      // continuations stay inside the already-admitted turn.
      if (step === 1) {
        const state = runs.get(agent) ?? { turnsStarted: 0 }
        state.turnsStarted += 1
        runs.set(agent, state)
        if (state.turnsStarted > ceiling) {
          return { kind: 'reject', reason: { kind: 'quota', code: 'MAX_TURNS' } }
        }
      }
      return next()
    })
  }

  if (maxOutputTokensPerTurn !== undefined) {
    const ceiling = maxOutputTokensPerTurn
    ctx.on('agent/request', async (_payload, next): Promise<LlmCallConfig> => {
      const call = await next()
      if (call.maxTokens !== undefined && call.maxTokens <= ceiling) return call
      return { ...call, maxTokens: ceiling }
    })
  }
}

export default apply
