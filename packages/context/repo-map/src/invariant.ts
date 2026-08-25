/** Package-owned repository-map injection invariants. @module @maple/context-repo-map/invariant */

import type { Context } from '@maple/cordis'
import type { Session, SessionEvent } from '@maple/session'
import type { InvariantFailure, InvariantInstaller } from '@maple/invariants'

const PACKAGE_NAME = '@maple/context-repo-map'
const SOURCE_NAME = 'repo-map'
const HEADER_LINE = '=== REPOSITORY MAP (AST Structure & Key Symbols) ==='

/** Cordis companion plugin name. */
export const name = 'repo-map-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one plugin-attributed map against its session position and its own
 * snapshot contract: the section text must be exactly what the model read,
 * and the append must land inside an open turn.
 */
function validateReading(history: readonly SessionEvent[], event: SessionEvent<'user/message'>, fail: InvariantFailure): void {
  const blockValue: unknown = event.data.content[0]
  const block = typeof blockValue === 'object' && blockValue !== null
    ? blockValue as Record<string, unknown>
    : undefined
  const blockText = block?.text
  if (event.data.content.length !== 1
    || block === undefined
    || Object.keys(block).length !== 2
    || block.type !== 'text'
    || typeof blockText !== 'string') {
    fail('repo-map messages must contain exactly one text block')
  }
  if (!blockText.startsWith(HEADER_LINE)) {
    fail('repo-map message must open with the package-owned header line')
  }
  const source = event.data.source
  /* v8 ignore next 2 -- replay and dispatch callers select this exact package-owned source before validation. */
  if (source.kind !== 'plugin' || source.plugin !== SOURCE_NAME) {
    fail('repo-map source must retain package ownership')
  }
  const sections: unknown = 'sections' in source ? source.sections : undefined
  const sectionValue: unknown = Array.isArray(sections) ? sections[0] : undefined
  const section = typeof sectionValue === 'object' && sectionValue !== null
    ? sectionValue as Record<string, unknown>
    : undefined
  if (Object.keys(source).length !== 4
    || source.form !== 'snapshot'
    || !Array.isArray(sections)
    || sections.length !== 1
    || section === undefined
    || Object.keys(section).length !== 2
    || section.name !== SOURCE_NAME
    || section.text !== blockText) {
    fail('repo-map source must carry only the exact snapshot text, not request authority')
  }
  let openTurn = false
  for (const past of history) {
    if (past.type === 'turn/start') openTurn = true
    if (past.type === 'turn/end') openTurn = false
  }
  if (!openTurn) fail('repo-map reading must be appended inside an open turn')
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate all package-owned maps already present in one session. */
function validateSession(session: Session, fail: InvariantFailure): void {
  for (const [index, event] of session.events.entries()) {
    if (event.type !== 'user/message'
      || event.data.source.kind !== 'plugin'
      || event.data.source.plugin !== SOURCE_NAME) continue
    validateReading(session.events.slice(0, index), event, fail)
  }
}

/** Install validation for loaded and newly appended context readings. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) validateSession(session, fail)
  ctx.on('session/created', (session) => { validateSession(session, fail) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type !== 'user/message'
      || event.data.source.kind !== 'plugin'
      || event.data.source.plugin !== SOURCE_NAME) return
    validateReading(session.events, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the repo-map invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
