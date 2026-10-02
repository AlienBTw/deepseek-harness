/**
 * Package-owned invariant companion for `@maple/credentials-keychain`.
 * @module @maple/credentials-keychain/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@maple/cordis'
import type { InvariantInstaller } from '@maple/invariants'

const PACKAGE_NAME = '@maple/credentials-keychain'

/** Cordis companion plugin name. */
export const name = 'credentials-keychain-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the Service Definition companion (`dsh-credentials/invariant`) owns the
 * `credentials/reference-updated` lifecycle contract; this provider's keychain store is
 * asynchronous I/O pinned by its unit suite.
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
