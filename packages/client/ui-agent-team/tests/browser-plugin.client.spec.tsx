// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@maple/client-test-runtime'
import { zh as commonZh } from '@maple/client-locale/src/locales/zh.ts'
import type { AgentTeamProjection } from '@maple/agent-team/client'
import type {} from '../src/client/index.ts'
import { TeamTaskBoard } from '../src/client/TeamTaskBoardDock.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const board: AgentTeamProjection = {
  tasks: [
    {
      id: 'task-1' as AgentTeamProjection['tasks'][number]['id'],
      subject: 'Implement auth',
      status: 'in_progress',
      blockedBy: [],
      writeScopes: ['src/auth'],
    },
    {
      id: 'task-2' as AgentTeamProjection['tasks'][number]['id'],
      subject: 'Write tests',
      status: 'pending',
      blockedBy: ['task-1' as AgentTeamProjection['tasks'][number]['id']],
      writeScopes: [],
    },
  ],
}

describe('@maple/client-ui-agent-team browser plugin', () => {
  it('renders tasks from the projection', () => {
    const t = makeTranslate({ ...commonZh, ...zh })
    render(<TeamTaskBoard board={board} t={t} />)
    expect(screen.getByText('团队任务')).toBeTruthy()
    expect(screen.getByText('Implement auth')).toBeTruthy()
    expect(screen.getByText('Write tests')).toBeTruthy()
    expect(screen.getByText('等待依赖')).toBeTruthy()
  })

  it('renders nothing when the projection is empty', () => {
    const t = makeTranslate({ ...commonZh, ...zh })
    const { container } = render(<TeamTaskBoard board={{ tasks: [] }} t={t} />)
    expect(container.firstChild).toBeNull()
  })
})
