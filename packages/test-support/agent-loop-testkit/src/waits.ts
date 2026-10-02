/**
 * Event-driven wait helpers for agent-loop tests. Prefer these over wall-clock
 * `setTimeout` sleeps so scheduling races surface as hangs or ordering failures
 * instead of flaky timing.
 * @module @maple/agent-loop-testkit/waits
 */

import type { Context } from '@maple/cordis'
import type { Agent, AgentStatus } from '@maple/agent'
import type { Session, SessionEvent, SessionEventType } from '@maple/session'

/**
 * Wait for the agent's next `agent/status` emission matching `status`.
 *
 * Resolves on the next matching transition, not the current value — so a
 * caller that arms this before `send`/`followup` observes the turn's later
 * idle, and a caller that arms it while already idle still waits for the next
 * idle after work starts.
 * @param ctx - context that publishes `agent/status`.
 * @param agent - agent whose transitions to observe.
 * @param status - status value to wait for.
 * @returns after the matching status event fires.
 */
export function waitForStatus(ctx: Context, agent: Agent, status: AgentStatus): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status: next }) => {
      if (subject === agent && next === status) {
        dispose()
        resolve()
      }
    })
  })
}

/**
 * Wait for the agent's next transition to `idle` after waking work.
 * @param ctx - context that publishes `agent/status`.
 * @param agent - agent whose idle transition to observe.
 * @returns after the next idle status event fires.
 */
export function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return waitForStatus(ctx, agent, 'idle')
}

/** Match a session event by type name or by a predicate over the full event. */
export type SessionEventMatch = SessionEventType | ((event: SessionEvent) => boolean)

/**
 * Wait until `count` matching `session/event` publications arrive for `session`.
 * @param ctx - context that publishes `session/event`.
 * @param session - session whose events to observe.
 * @param match - event type string or predicate.
 * @param count - number of matches required (default 1).
 * @returns the matching events in arrival order.
 */
export function waitForSessionEvent(
  ctx: Context,
  session: Session,
  match: SessionEventMatch,
  count = 1,
): Promise<SessionEvent[]> {
  if (!Number.isSafeInteger(count) || count < 1) {
    return Promise.reject(new Error('waitForSessionEvent count must be a positive safe integer'))
  }
  const matches = typeof match === 'function'
    ? match
    : (event: SessionEvent): boolean => event.type === match
  return new Promise((resolve) => {
    const seen: SessionEvent[] = []
    const dispose = ctx.on('session/event', (subject, event) => {
      if (subject !== session || !matches(event)) return
      seen.push(event)
      if (seen.length >= count) {
        dispose()
        resolve(seen)
      }
    })
  })
}
