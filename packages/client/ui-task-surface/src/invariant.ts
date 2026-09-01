/**
 * Package-owned invariant companion for `@maple/client-ui-task-surface`.
 * @module @maple/client-ui-task-surface/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@maple/cordis'
import type { InvariantInstaller } from '@maple/invariants'

const PACKAGE_NAME = '@maple/client-ui-task-surface'

/** Cordis companion plugin name. */
export const name = 'client-ui-task-surface-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a single TaskSurfaceDock registration whose disposal is
 * proven by the HMR-safety spec — the plugin owns no store (state arrives on the
 * taskSurface projection and through the Remote getActive call), emits no cordis
 * events, and holds no cross-plugin mutable state.
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
