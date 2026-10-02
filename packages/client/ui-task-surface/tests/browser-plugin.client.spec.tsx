// @vitest-environment jsdom
/**
 * ui-task-surface browser half on a real cordis Context with fake slots/
 * remote faces: the plugin registers the TaskSurface dock entry at
 * conversation.input.dock, the keyed show_task_surface transcript row, wires
 * getActive/submit/dismiss through ctx.remote.taskSurface, and drops both
 * entries when the plugin fiber unloads.
 */
import { Context, Service } from '@maple/cordis'
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach } from 'vitest'
import { SlotRegistry, type SessionId } from '@maple/client-runtime/client'
import { LocaleRuntime } from '@maple/client-locale/client'
import { makeTranslate } from '@maple/client-test-runtime'
import { zh as commonZh } from '@maple/client-locale/src/locales/zh.ts'
import type {
  DismissTaskSurfaceResult,
  GetActiveTaskSurfaceResult,
  SubmitTaskSurfaceResult,
  TaskSurfaceModelV1,
} from '@maple/task-surface/client'
import { TaskSurfaceDismissalId, TaskSurfaceId, TaskSurfaceSubmissionId } from '@maple/task-surface/client'
import type { ToolResultNode } from '@maple/client-runtime/client'
import type { TaskSurfaceDockActions } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { TaskSurfacePanel } from '../src/client/TaskSurfaceDock.tsx'
import { TaskSurfaceRow } from '../src/client/TaskSurfaceRow.tsx'
import { zh } from '../src/client/locales.ts'
import { apply as nodeApply } from '../src/index.ts'

afterEach(cleanup)

const sid = (k: string): SessionId => k as SessionId

const testModel: TaskSurfaceModelV1 = {
  version: 1,
  title: 'Choose Environment',
  description: 'Pick staging or production.',
  sections: [{
    id: 'sec-1',
    title: 'Context',
    blocks: [{ kind: 'markdown', text: 'Pick staging or production.' }],
  }],
  fields: [{
    kind: 'choice',
    id: 'env',
    label: 'Environment',
    options: [
      { id: 'staging', label: 'Staging' },
      { id: 'production', label: 'Production' },
    ],
    required: true,
  }],
  submit: { label: 'Continue' },
}

/** Boot the plugin over fake faces; Remote methods record arguments and answer per the script. */
async function bench(options: {
  getActive?: GetActiveTaskSurfaceResult
  submit?: SubmitTaskSurfaceResult
  dismiss?: DismissTaskSurfaceResult
} = {}) {
  const ctx = new Context()
  const calls: { method: string; args: unknown[] }[] = []
  function answer<T>(method: string, value: T) {
    return (...args: unknown[]) => {
      calls.push({ method, args })
      return Promise.resolve({ ok: true as const, value })
    }
  }
  const getActive = vi.fn(answer('getActive', options.getActive ?? { active: false, reason: 'not-open' } satisfies GetActiveTaskSurfaceResult))
  const submit = vi.fn(answer('submit', options.submit ?? { accepted: true, messageId: 'msg-1' as never, phase: 'queued' } satisfies SubmitTaskSurfaceResult))
  const dismiss = vi.fn(answer('dismiss', options.dismiss ?? { dismissed: true, eventSeq: 1 } satisfies DismissTaskSurfaceResult))
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.taskSurface', { getActive, submit, dismiss })
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root', children: {
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
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
    toolview: () => {
      const entry = ctx.slots.entries('tool.call.toolview')[0]
      if (entry === undefined) return undefined
      return { ...entry.options, locale: entry.locale }
    },
  }
}

describe('ui-task-surface browser plugin', () => {
  it('registers the TaskSurface dock and keyed transcript row', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.entry()).toMatchObject({ id: 'task-surface', order: 30, locale: 'taskSurface' })
    expect(b.entry()?.inject).toBeTypeOf('function')
    expect(b.toolview()).toMatchObject({ key: 'show_task_surface', locale: 'taskSurface' })
  })

  it('forwards getActive, submit, and dismiss to the Remote namespace', async () => {
    const active: GetActiveTaskSurfaceResult = {
      active: true,
      callId: 'call-1' as never,
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
      values: { env: 'staging' },
    })
    await verbs.onDismiss({
      surfaceId: TaskSurfaceId('surf-1'),
      dismissalId: TaskSurfaceDismissalId('dsm-1'),
    })
    expect(b.calls).toEqual([
      { method: 'getActive', args: [{ sessionId: sid('s1') }] },
      {
        method: 'submit',
        args: [sid('s1'), {
          surfaceId: TaskSurfaceId('surf-1'),
          submissionId: TaskSurfaceSubmissionId('sub-1'),
          values: { env: 'staging' },
        }],
      },
      {
        method: 'dismiss',
        args: [sid('s1'), {
          surfaceId: TaskSurfaceId('surf-1'),
          dismissalId: TaskSurfaceDismissalId('dsm-1'),
        }],
      },
    ])
  })

  it('drops the dock and toolview entries when the plugin fiber unloads (HMR safety)', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.entry()).toBeDefined()
    expect(b.toolview()).toBeDefined()
    await b.fiber.dispose()
    expect(b.entry()).toBeUndefined()
    expect(b.toolview()).toBeUndefined()
  })
})

describe('TaskSurfacePanel adapter', () => {
  it('renders sections, fields, and submits captured values', async () => {
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
    const onDismiss = vi.fn(async (): Promise<DismissTaskSurfaceResult> => ({
      dismissed: true,
      eventSeq: 1,
    }))
    const t = makeTranslate(zh, commonZh)
    render(
      <TaskSurfacePanel
        active={{ callId: 'call-1' as never, surfaceId: TaskSurfaceId('surf-1') }}
        onGetActive={onGetActive}
        onSubmit={onSubmit}
        onDismiss={onDismiss}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('Choose Environment')).toBeTruthy()
      expect(screen.getByRole('radio', { name: 'Staging' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Staging' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      surfaceId: TaskSurfaceId('surf-1'),
      values: { env: 'staging' },
    })
  }, 15_000)

  it('dismisses through the inject face', async () => {
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
    const onDismiss = vi.fn(async (): Promise<DismissTaskSurfaceResult> => ({
      dismissed: true,
      eventSeq: 1,
    }))
    const t = makeTranslate(zh, commonZh)
    render(
      <TaskSurfacePanel
        active={{ callId: 'call-1' as never, surfaceId: TaskSurfaceId('surf-1') }}
        onGetActive={onGetActive}
        onSubmit={onSubmit}
        onDismiss={onDismiss}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })
    expect(onDismiss.mock.calls[0]![0]).toMatchObject({
      surfaceId: TaskSurfaceId('surf-1'),
    })
  }, 15_000)
})

describe('TaskSurfaceRow', () => {
  const t = makeTranslate(zh, commonZh)

  function rowProps(block: unknown): Parameters<typeof TaskSurfaceRow>[0] {
    return {
      callId: 'c1', toolName: 'show_task_surface', block, t,
      openFile: vi.fn(),
      sessionId: 's1',
      useSessions: () => undefined,
    } as unknown as Parameters<typeof TaskSurfaceRow>[0]
  }

  const resultNode = (argsRaw: string, resultText: string | null, over?: Partial<ToolResultNode>): ToolResultNode => ({
    kind: 'tool-result', seq: 10, time: 2_000, callTime: 1_000, callId: 'c1',
    call: { name: 'show_task_surface', argsRaw },
    content: resultText === null ? [] : [{ type: 'text', text: resultText }],
    isError: false, callView: null, resultView: null, subCalls: [], ...over,
  })

  it('settled open surface shows title and awaiting summary', () => {
    const args = JSON.stringify({ model: { version: 1, title: 'Choose Environment', sections: [], submit: { label: 'Continue' } } })
    render(<TaskSurfaceRow {...rowProps(resultNode(args, 'Rendered Task Surface: "Choose Environment". Awaiting user submission.', {
      meta: {
        kind: 'dsh/task-surface',
        version: 1,
        surfaceId: 'surface-fixture-1',
        model: testModel,
      },
    }))} />)
    expect(screen.getByText('任务面板')).toBeTruthy()
    expect(screen.getByText('Choose Environment · 等待提交')).toBeTruthy()
  })
})

describe('ui-task-surface node half', () => {
  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
