/** Package-owned invariants for @maple/tool-recall. @module @maple/tool-recall/invariant */

import type { Context } from '@maple/cordis'
import type { InvariantFailure, InvariantInstaller } from '@maple/invariants'

const PACKAGE_NAME = '@maple/tool-recall'

/** Cordis companion plugin name. */
export const name = 'tool-recall-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Install invariant checks for tool-recall. */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {
  // tool-recall consumes existing session and compaction events without owning new durable events.
}, { inject: [] })

/**
 * Register the tool-recall invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
