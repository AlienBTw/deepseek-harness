/**
 * Universal session-log replay assertion for harness tests: seeding a fresh
 * Session from the live log must reproduce identical `deriveMessages()` output.
 * @module @maple/agent-loop-testkit/replay
 */

import { deepStrictEqual } from 'node:assert/strict'
import type { Context } from '@maple/cordis'
import { SessionId, type Session } from '@maple/session'

/**
 * Replay `session.events` into a fresh store Session and assert derived
 * message history equality.
 * @param ctx - context owning `sessions` (must still be live).
 * @param session - live session whose log to replay.
 * @param replayId - optional id for the seeded session; defaults to a unique
 *   id derived from the source session id.
 * @returns the seeded replay Session after the assertion passes.
 * @throws when `deriveMessages()` after seed differs from the live derivation.
 */
export function assertDeriveMessagesReplay(
  ctx: Context,
  session: Session,
  replayId: SessionId = SessionId(`replay-assert-${session.id}-${String(session.seq)}`),
): Session {
  const expected = session.deriveMessages()
  const replayed = ctx.sessions.create(replayId, { seed: [...session.events] })
  deepStrictEqual(
    replayed.deriveMessages(),
    expected,
    `session log for ${session.id} does not replay to identical deriveMessages()`,
  )
  return replayed
}

/**
 * Run `body`, then assert the session still replays to identical derived messages.
 * @param ctx - context owning `sessions`.
 * @param session - session produced by the harness under test.
 * @param body - test body that mutates the session through the loop.
 * @returns after the body settles and the replay assertion passes.
 */
export async function withDeriveMessagesReplay(
  ctx: Context,
  session: Session,
  body: () => Promise<void>,
): Promise<void> {
  await body()
  assertDeriveMessagesReplay(ctx, session)
}

/**
 * Collect sessions during a test (or suite) and assert replay for each at the end.
 *
 * Typical use: construct one tracker per harness `ctx`, `track` every agent
 * session under test, then call {@link SessionReplayTracker.assertAll} from
 * `afterEach` (or at the end of the test). Call {@link SessionReplayTracker.clear}
 * after asserting when the tracker outlives a single test.
 */
export class SessionReplayTracker {
  readonly #ctx: Context
  readonly #sessions: Session[] = []

  /**
   * @param ctx - context owning `sessions` for every tracked session.
   */
  constructor(ctx: Context) {
    this.#ctx = ctx
  }

  /**
   * Remember `session` for a later {@link assertAll} call.
   * @param session - live session to check.
   * @returns the same session for chaining at create sites.
   */
  track(session: Session): Session {
    this.#sessions.push(session)
    return session
  }

  /**
   * Assert deriveMessages replay for every tracked session, in track order.
   * @throws on the first divergent replay.
   */
  assertAll(): void {
    for (const [index, session] of this.#sessions.entries()) {
      assertDeriveMessagesReplay(
        this.#ctx,
        session,
        SessionId(`replay-track-${session.id}-${String(index)}`),
      )
    }
  }

  /** Drop every tracked session without asserting. */
  clear(): void {
    this.#sessions.length = 0
  }
}
