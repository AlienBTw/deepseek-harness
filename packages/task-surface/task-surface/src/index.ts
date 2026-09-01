/**
 * Declarative Task Surface domain and service.
 * @module @maple/task-surface
 */

import { Context } from '@maple/cordis'
import { TaskSurfaceService } from './service.ts'

export * from './brand.ts'
export * from './types.ts'
export * from './parser.ts'
export * from './projection.ts'
export * from './service.ts'

export const name = 'task-surface'

export function apply(ctx: Context): void {
  ctx.plugin(TaskSurfaceService)
}

export default apply
