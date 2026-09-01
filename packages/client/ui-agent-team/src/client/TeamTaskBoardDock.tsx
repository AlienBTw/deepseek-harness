/**
 * TeamTaskBoardDock: read-only task list above the composer. Live state arrives
 * through `useProjection('agentTeam')`; an empty task list renders nothing.
 */

import type { AgentTeamProjection, AgentTeamTaskRow } from '@maple/agent-team/client'
import type { PropsLocale } from '@maple/client-ui-slots'
import type { AgentTeamKey } from './locales.ts'
import css from './TeamTaskBoardDock.module.css'

const STATUS_LABELS = {
  pending: 'status.pending',
  in_progress: 'status.in_progress',
  completed: 'status.completed',
  deleted: 'status.completed',
} as const satisfies Record<AgentTeamTaskRow['status'], AgentTeamKey>

export interface TeamTaskBoardProps {
  /** Current task-board projection; undefined means loading or absent. */
  board: AgentTeamProjection | undefined
}

function TaskRow({ task, t }: { task: AgentTeamTaskRow } & PropsLocale<'agentTeam'>) {
  const statusKey = STATUS_LABELS[task.status as keyof typeof STATUS_LABELS]
  const statusLabel = statusKey === undefined ? task.status : t(statusKey)
  return (
    <li className={css.row} data-task-id={task.id}>
      <span className={css.subject}>{task.subject}</span>
      <span className={css.meta}>
        <span className={css.status}>{statusLabel}</span>
        {task.blockedBy.length > 0 && (
          <span className={css.blocked}>{t('blocked')}</span>
        )}
      </span>
    </li>
  )
}

export function TeamTaskBoard({ board, t }: TeamTaskBoardProps & PropsLocale<'agentTeam'>) {
  if (board === undefined || board.tasks.length === 0) return null
  return (
    <div className={css.dock} data-agent-team-board aria-label={t('dock.aria')}>
      <div className={css.panel}>
        <div className={css.header}>{t('title')}</div>
        <ul className={css.list}>
          {board.tasks.map(task => (
            <TaskRow key={task.id} task={task} t={t} />
          ))}
        </ul>
      </div>
    </div>
  )
}

/** Full props of the dock entry. */
export type TeamTaskBoardDockProps =
  import('@maple/client-ui-slots').PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'agentTeam'>

/** Dock adapter: reads the host-computed `agentTeam` projection. */
export function TeamTaskBoardDock({ useProjection, t }: TeamTaskBoardDockProps) {
  const projection = useProjection('agentTeam')
  return <TeamTaskBoard board={projection} t={t} />
}
