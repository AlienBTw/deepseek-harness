/** Package-owned invariants for @maple/task-surface. @module @maple/task-surface/invariant */

import type { Context } from '@maple/cordis'
import type { Session, SessionEvent } from '@maple/session'
import type { InvariantFailure, InvariantInstaller } from '@maple/invariants'

const PACKAGE_NAME = '@maple/task-surface'

export const name = 'task-surface-invariant'
export const inject = ['invariants']

function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'task-surface/dismissed') {
    if (typeof event.data.surfaceId !== 'string' || !event.data.surfaceId) {
      fail('task-surface/dismissed requires a valid surfaceId')
    }
    if (typeof event.data.dismissalId !== 'string' || !event.data.dismissalId) {
      fail('task-surface/dismissed requires a valid dismissalId')
    }
  }
}

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
