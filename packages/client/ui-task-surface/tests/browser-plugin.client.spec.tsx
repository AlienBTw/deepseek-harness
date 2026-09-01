// @vitest-environment jsdom
/**
 * ui-task-surface browser half on a real cordis Context with fake slots/
 * remote faces: the plugin registers the TaskSurface dock entry at
 * conversation.input.dock, wires getActive/submit through ctx.remote.taskSurface,
 * and drops the entry when the plugin fiber unloads.
 */
import { Context, Service } from '@maple/cordis'
import { describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach } from 'vitest'
import { SlotRegistry, type SessionId } from '@maple/client-runtime/client'
import { LocaleRuntime } from '@maple/client-locale/client'
import { makeTranslate } from '@maple/client-test-runtime'
import { zh as commonZh } from '@maple/client-locale/src/locales/zh.ts'
import type {
  GetActiveTaskSurfaceResult,
  SubmitTaskSurfaceResult,
  TaskSurfaceModelV1,
} from '@maple/task-surface/client'
import { TaskSurfaceId, TaskSurfaceSubmissionId } from '@maple/task-surface/client'
import type { TaskSurfaceDockActions } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { TaskSurfacePanel } from '../src/client/TaskSurfaceDock.tsx'
import { zh } from '../src/client/locales.ts'
import { apply as nodeApply } from '../src/index.ts'

afterEach(cleanup)

const sid = (k: string): SessionId => k as SessionId

const testModel: TaskSurfaceModelV1 = {
  version: 1,
  title: 'Choose Environment',
  sections: [{ id: 'sec-1', blocks: [{ kind: 'markdown', text: 'Pick one' }] }],
  submit: { label: 'Continue' },
}

/** Boot the plugin over fake faces; Remote methods record arguments and answer per the script. */
async function bench(options: {
  getActive?: GetActiveTaskSurfaceResult
  submit?: SubmitTaskSurfaceResult
} = {}) {
  const ctx = new Context()
  const calls: { method: string; args: unknown[] }[] = []
  const getActive = vi.fn(async (...args: unknown[]) => {
    calls.push({ method: 'getActive', args })
    return options.getActive ?? { active: false, reason: 'not-open' } satisfies GetActiveTaskSurfaceResult
  })
  const submit = vi.fn(async (...args: unknown[]) => {
    calls.push({ method: 'submit', args })
    return options.submit ?? { accepted: true, messageId: 'msg-1' as never, phase: 'queued' } satisfies SubmitTaskSurfaceResult
  })
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.taskSurface', { getActive, submit })
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root', children: {
      'conversation.input.dock': { kind: 'list', scope: 'session' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  return {
    ctx,
    fiber,
    calls,
    entry: () => {
      const entry = ctx.slots.entries('conversation.input.dock')[0]
      if (entry === undefined) return undefined
      return {
        ...entry.options,
        locale: entry.locale,
        inject: entry.inject as unknown as ((sessionId: SessionId) => TaskSurfaceDockActions) | undefined,
      }
    },
  }
}

describe('ui-task-surface browser plugin', () => {
  it('registers the TaskSurface dock with Remote-backed inject face', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.entry()).toMatchObject({ id: 'task-surface', order: 30, locale: 'taskSurface' })
    expect(b.entry()?.inject).toBeTypeOf('function')
  })

  it('forwards getActive and submit to the Remote namespace', async () => {
    const active: GetActiveTaskSurfaceResult = {
      active: true,
      callId: 'call-1' as GetActiveTaskSurfaceResult & { active: true } extends { callId: infer C } ? C : never,
      surfaceId: TaskSurfaceId('surf-1'),
      model: testModel,
      pending: null,
    }
    const b = await bench({ getActive: active })
    await b.fiber.await()
    const verbs = b.entry()!.inject!(sid('s1'))
    await verbs.onGetActive()
    await verbs.onSubmit({
      surfaceId: TaskSurfaceId('surf-1'),
      submissionId: TaskSurfaceSubmissionId('sub-1'),
      values: {},
    })
    expect(b.calls).toEqual([
      { method: 'getActive', args: [{ sessionId: sid('s1') }] },
      {
        method: 'submit',
        args: [sid('s1'), {
          surfaceId: TaskSurfaceId('surf-1'),
          submissionId: TaskSurfaceSubmissionId('sub-1'),
          values: {},
        }],
      },
    ])
  })

  it('drops the dock entry when the plugin fiber unloads (HMR safety)', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.entry()).toBeDefined()
    await b.fiber.dispose()
    expect(b.entry()).toBeUndefined()
  })
})

describe('TaskSurfacePanel adapter', () => {
  it('renders the active title and submits through the inject face', async () => {
    const onGetActive = vi.fn(async (): Promise<GetActiveTaskSurfaceResult> => ({
      active: true,
      callId: 'call-1' as never,
      surfaceId: TaskSurfaceId('surf-1'),
      model: testModel,
      pending: null,
    }))
    const onSubmit = vi.fn(async (): Promise<SubmitTaskSurfaceResult> => ({
      accepted: true,
      messageId: 'msg-1' as never,
      phase: 'queued',
    }))
    const t = makeTranslate(zh, commonZh)
    render(
      <TaskSurfacePanel
        active={{ callId: 'call-1' as never, surfaceId: TaskSurfaceId('surf-1') }}
        onGetActive={onGetActive}
        onSubmit={onSubmit}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(document.body.textContent).toContain('Choose Environment')
    })
    const button = document.querySelector('button')
    expect(button?.textContent).toBe('Continue')
    button?.click()
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
  })
})

describe('ui-task-surface node half', () => {
  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
