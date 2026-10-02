/**
 * Package-owned invariant companion for `@maple/run-budget`.
 * @module @maple/run-budget/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@maple/cordis'
import type { InvariantInstaller } from '@maple/invariants'

const PACKAGE_NAME = '@maple/run-budget'

/** Cordis companion plugin name. */
export const name = 'run-budget-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this policy plugin owns only process-local WeakMap
 * counters keyed by live agents, which dissolve with the agent object.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
