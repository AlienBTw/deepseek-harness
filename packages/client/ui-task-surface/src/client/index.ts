/**
 * Task Surface UI plugin, browser half: TaskSurfaceDock registered in the
 * conversation input dock over the taskSurface projection. The inject face
 * carries getActive and submit through ctx.remote.taskSurface.
 */
import type { ClientContext, SessionId } from '@maple/client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@maple/api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.dock entry).
import type {} from '@maple/client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@maple/client-locale/client'
// Type-only: the `taskSurface` SessionProjectionMap key merge.
import type {} from '@maple/task-surface/client'
import type { TaskSurfaceDockActions } from './slots.ts'
import { TaskSurfaceDock } from './TaskSurfaceDock.tsx'
import { en, zh, type TaskSurfaceKey } from './locales.ts'

export type { TaskSurfaceDockActions } from './slots.ts'
export type { TaskSurfaceKey } from './locales.ts'

declare module '@maple/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Task Surface dock copy. */
    taskSurface: TaskSurfaceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'taskSurface'

/** Required services for the Task Surface dock, Remote mutations, and copy. */
export const inject = ['slots', 'remote', 'remote.taskSurface', 'locale']

/**
 * Client plugin body: register the TaskSurface dock entry with Remote verbs.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-task-surface: dictionaries')

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'task-surface',
    order: 30,
    locale: NS,
    inject: (sessionId: SessionId): TaskSurfaceDockActions => ({
      onGetActive: async () => {
        const result = await ctx.remote.taskSurface.getActive({ sessionId })
        if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
        return result.value
      },
      onSubmit: async (request) => {
        const result = await ctx.remote.taskSurface.submit(sessionId, request)
        if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
        return result.value
      },
    }),
  }, TaskSurfaceDock))
}
