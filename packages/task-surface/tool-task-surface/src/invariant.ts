/** Package-owned invariants for @maple/tool-task-surface. @module @maple/tool-task-surface/invariant */

import type { Context } from '@maple/cordis'
import type { InvariantFailure, InvariantInstaller } from '@maple/invariants'

const PACKAGE_NAME = '@maple/tool-task-surface'

export const name = 'tool-task-surface-invariant'
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {
  // tool-task-surface is a stateless tool definition plugin.
}, { inject: [] })

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
