import { describe, expect, it } from 'vitest'
import { applyAgentTeamProjection, initialAgentTeamProjection } from '../src/projection.ts'
import { TeamId, TeamTaskId } from '../src/types.ts'

const TEAM = TeamId('session-root')

describe('applyAgentTeamProjection', () => {
  it('folds team/task events into a sorted non-deleted task list', () => {
    let state = initialAgentTeamProjection
    state = applyAgentTeamProjection(state, {
      type: 'team/task',
      seq: 1,
      time: 1,
      data: {
        version: 1,
        teamId: TEAM,
        task: {
          id: TeamTaskId('task-2'),
          revision: 1,
          subject: 'second',
          description: 'second',
          status: 'pending',
          blockedBy: [],
          writeScopes: [],
        },
      },
    })
    state = applyAgentTeamProjection(state, {
      type: 'team/task',
      seq: 2,
      time: 2,
      data: {
        version: 1,
        teamId: TEAM,
        task: {
          id: TeamTaskId('task-1'),
          revision: 1,
          subject: 'first',
          description: 'first',
          status: 'pending',
          blockedBy: [],
          writeScopes: [],
        },
      },
    })
    expect(state.tasks.map(task => task.id)).toEqual([TeamTaskId('task-1'), TeamTaskId('task-2')])
    state = applyAgentTeamProjection(state, {
      type: 'team/task',
      seq: 3,
      time: 3,
      data: {
        version: 1,
        teamId: TEAM,
        task: {
          id: TeamTaskId('task-1'),
          revision: 2,
          subject: 'first',
          description: 'first',
          status: 'deleted',
          blockedBy: [],
          writeScopes: [],
        },
      },
    })
    expect(state.tasks.map(task => task.id)).toEqual([TeamTaskId('task-2')])
  })
})
