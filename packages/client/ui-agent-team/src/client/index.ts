/**
 * Agent Teams task-board UI plugin, browser half.
 */
import type { ClientContext } from '@maple/client-runtime/client'
import type {} from '@maple/client-locale/client'
import type {} from '@maple/client-ui-conversation/client'
import type {} from '@maple/agent-team/client'
import { TeamTaskBoardDock } from './TeamTaskBoardDock.tsx'
import { en, NS, zh, type AgentTeamKey } from './locales.ts'

declare module '@maple/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent Teams task-board copy. */
    agentTeam: AgentTeamKey
  }
}

/** Required services for the task-board dock and copy. */
export const inject = ['slots', 'locale']

/** Register the Agent Teams task-board dock entry. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-agent-team: dictionaries')
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'agent-team',
    order: 20,
    locale: NS,
  }, TeamTaskBoardDock))
}
