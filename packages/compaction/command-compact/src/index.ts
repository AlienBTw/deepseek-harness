/**
 * Human-facing `/compact` command over the backend-independent compaction seam.
 * @module @maple/command-compact
 */

import type { Context } from '@maple/cordis'
import { ManualCompactionError } from '@maple/compaction'
import type { CompactionId } from '@maple/compaction'
import type { CommandInvocation, CommandResult } from '@maple/commands'
import type { Session } from '@maple/session'

export const name = 'command-compact'
export const inject = ['commands', 'compaction']

const USAGE = 'Usage: /compact (no arguments)'

/**
 * Locate the durable `compaction/summary` seq for a completed transaction.
 * @param session - session that owns the compaction lifecycle events.
 * @param compactionId - identity shared by start/summary/end.
 * @returns the summary event seq, or `undefined` when absent (should not happen after success).
 */
function summarySeqFor(session: Session, compactionId: CompactionId): number | undefined {
  for (let i = session.events.length - 1; i >= 0; i -= 1) {
    const event = session.events[i]
    if (event === undefined) continue
    if (event.type === 'compaction/summary' && event.data.compactionId === compactionId) {
      return event.seq
    }
  }
  return undefined
}

/** Fail loudly if a locally closed union gains an unhandled member. */
/* v8 ignore start -- closed-union backstop is unreachable without violating the TypeScript contract */
function assertNever(value: never): never {
  throw new TypeError(`unknown manual compaction error code: ${String(value)}`)
}
/* v8 ignore stop */

/** Convert expected capability failures into concise human-only outcomes. */
function expectedFailure(error: ManualCompactionError): CommandResult {
  switch (error.code) {
    case 'busy':
      return {
        kind: 'error',
        text: 'Compaction is unavailable because this process has an active compaction, or the agent is not idle.',
      }
    case 'cancelled':
      return { kind: 'error', text: 'Compaction cancelled.' }
    case 'changed':
      return {
        kind: 'error',
        text: 'The history selected for compaction changed before it could be replaced. The conversation is unchanged; the attempt is recorded in the session log.',
      }
    case 'summary':
      return {
        kind: 'error',
        text: 'Compaction could not produce a useful summary. The conversation is unchanged; the attempt is recorded in the session log.',
      }
    case 'commit':
      return {
        kind: 'error',
        text: 'Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.',
      }
    case 'persistence':
      return {
        kind: 'error',
        text: 'Compaction finished, but the session could not be saved.',
      }
    /* v8 ignore next 2 -- ManualCompactionErrorCode is closed and every member is handled above */
    default: return assertNever(error.code)
  }
}

/** Execute one argument-free manual compaction request. */
async function executeCompact(
  ctx: Context,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  if (invocation.rawInput.trim().length > 0) {
    return { kind: 'error', text: USAGE }
  }
  try {
    const result = await ctx.compaction.compactNow(invocation.agent, invocation.signal, invocation.commandId)
    if (result === null) return { kind: 'success', text: 'No compactable history yet.' }
    const summarySeq = summarySeqFor(invocation.agent.session, result.compactionId)
    return {
      kind: 'success',
      text: `Compacted ${result.shadowedSeqs.length} history items (~${result.shadowedTokenCount} tokens).`,
      ...summarySeq === undefined ? {} : { sourceEventSeq: summarySeq },
    }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Compaction cancelled.' }
    if (error instanceof ManualCompactionError) return expectedFailure(error)
    throw error
  }
}

/**
 * Register `/compact` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the compaction seam.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<CommandResult>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    const operation = executeCompact(ctx, invocation)
    active.add(operation)
    const retire = (): void => { active.delete(operation) }
    // Both branches retire without rethrowing, so the derived observer promise
    // cannot become an unhandled mirror of an expected handler rejection.
    void operation.then(retire, retire)
    return operation
  }

  ctx.effect(function* () {
    // Yield drain before registration: composite teardown is LIFO, so no new
    // invocation can enter while already-started handler promises quiesce.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      name: 'compact',
      description: 'Compact older conversation history',
      handler,
    })
  }, 'command-compact lifecycle')
}
