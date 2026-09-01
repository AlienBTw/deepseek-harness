import { describe, expect, it } from 'vitest'
import { Context } from '@maple/cordis'
import { Inbox } from '@maple/agent'
import type { Agent } from '@maple/agent'
import { CallId } from '@maple/llm'
import { Session, SessionId } from '@maple/session'
import SystemPrompt from '@maple/system-prompt'
import ToolRuntime from '@maple/tools'
import { TaskSurfaceService } from '@maple/task-surface'
import * as tool from '../src/index.ts'

const testSignal = new AbortController().signal

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TaskSurfaceService)
  await ctx.plugin(tool)
  return ctx
}

describe('@maple/tool-task-surface', () => {
  it('registers show_task_surface tool schema and concludes turn upon execution', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'show_task_surface')
    expect(schema).toBeDefined()

    const rawModel = {
      version: 1,
      title: 'Review Pull Request',
      sections: [
        {
          id: 'diff-sec',
          blocks: [
            { kind: 'diff', filename: 'src/main.ts', original: 'const x = 1;', modified: 'const x = 2;' },
          ],
        },
      ],
      submit: { label: 'Approve' },
    }

    const session = Session.create(SessionId('sess-tool'))
    const agent: Agent = {
      id: session.id,
      options: {},
      session,
      inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
      status: 'idle',
      ctx,
      followup: () => {},
      steer: () => {},
      inject: () => {},
      send: () => {},
      cancel() {},
      runMaintenance: task => task(new AbortController().signal),
      whenIdle: () => Promise.resolve(),
    }

    const result = await ctx.tools.execute({
      signal: testSignal,
      callId: CallId('call-1'),
      name: 'show_task_surface',
      arguments: { model: rawModel },
      agent,
    })

    expect(result).toBeDefined()
    expect(result.concludesTurn).toBe(true)
    const textBlock = result.content.find(b => b.type === 'text')
    expect(textBlock?.text).toContain('Review Pull Request')
  })
})
