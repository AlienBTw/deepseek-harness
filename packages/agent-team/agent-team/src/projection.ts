/**
 * Session projection for the Agent Teams task board.
 * @module @maple/agent-team/projection
 */

import type { SessionEvent } from '@maple/session'
import type { AgentTeamProjection, AgentTeamTaskRow } from './types.ts'
import type { TeamTaskSnapshot } from './types.ts'

/** Initial empty state for the Agent Teams session projection. */
export const initialAgentTeamProjection: AgentTeamProjection = {
  tasks: [],
}

function taskRow(task: TeamTaskSnapshot): AgentTeamTaskRow {
  return {
    id: task.id,
    subject: task.subject,
    status: task.status,
    blockedBy: [...task.blockedBy],
    writeScopes: [...task.writeScopes],
  }
}

function numericTaskOrder(left: AgentTeamTaskRow, right: AgentTeamTaskRow): number {
  const leftMatch = /^task-(\d+)$/u.exec(left.id)
  const rightMatch = /^task-(\d+)$/u.exec(right.id)
  if (leftMatch !== null && rightMatch !== null) return Number(leftMatch[1]) - Number(rightMatch[1])
  return left.id.localeCompare(right.id)
}

/**
 * Fold one session event into the Agent Teams task-board projection.
 * @param state - previous projection state.
 * @param event - durable session event.
 * @returns updated projection state.
 */
export function applyAgentTeamProjection(
  state: AgentTeamProjection,
  event: SessionEvent,
): AgentTeamProjection {
  if (event.type !== 'team/task') return state
  const task = event.data.task
  if (task.status === 'deleted') {
    const tasks = state.tasks.filter(row => row.id !== task.id)
    return tasks.length === state.tasks.length ? state : { tasks }
  }
  const next = taskRow(task)
  const index = state.tasks.findIndex(row => row.id === next.id)
  if (index >= 0) {
    const current = state.tasks[index]
    if (current === undefined) {
      const tasks = state.tasks.slice()
      tasks[index] = next
      return { tasks }
    }
    if (
      current.subject === next.subject
      && current.status === next.status
      && current.blockedBy.length === next.blockedBy.length
      && current.blockedBy.every((id, offset) => id === next.blockedBy[offset])
      && current.writeScopes.length === next.writeScopes.length
      && current.writeScopes.every((scope, offset) => scope === next.writeScopes[offset])
    ) {
      return state
    }
    const tasks = state.tasks.slice()
    tasks[index] = next
    return { tasks }
  }
  return { tasks: [...state.tasks, next].sort(numericTaskOrder) }
}
