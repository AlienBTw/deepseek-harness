/**
 * Package-owned invariant companion for `@maple/sidechat`.
 * @module @maple/sidechat/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@maple/cordis'
import type { InvariantInstaller } from '@maple/invariants'

const PACKAGE_NAME = '@maple/sidechat'

/** Cordis companion plugin name. */
export const name = 'sidechat-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: fork/merge write ordinary session events, and the
 * deny gate is a tools/pre-execute listener with no package-owned snapshot.
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
