// REAL-composition: boot task-surface + tool-task-surface through Loader.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@maple/cordis'
import Loader from '@maple/cordis-plugin-loader'
import Include from '@maple/cordis-plugin-include'
import AgentRegistry from '@maple/agent'
import SystemPrompt from '@maple/system-prompt'
import ToolRuntime from '@maple/tools'
import * as TaskSurface from '@maple/task-surface'
import * as ToolTaskSurface from '@maple/tool-task-surface'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-task-surface-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@maple/agent'",
    "- name: '@maple/system-prompt'",
    "- name: '@maple/tools'",
    "- name: '@maple/task-surface'",
    "- name: '@maple/tool-task-surface'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@maple/agent', AgentRegistry],
    ['@maple/system-prompt', SystemPrompt],
    ['@maple/tools', ToolRuntime],
    ['@maple/task-surface', TaskSurface],
    ['@maple/tool-task-surface', ToolTaskSurface],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      const mod = modules.get(specifier)
      if (mod === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      return mod
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('@maple/task-surface loader composition', () => {
  it('boots task-surface service and show_task_surface tool through Loader', async () => {
    const ctx = await boot()
    expect(ctx.taskSurface).toBeDefined()
    const schema = ctx.tools.schemas().find(s => s.name === 'show_task_surface')
    expect(schema).toBeDefined()
    expect(schema?.description).toContain('Task Surface')
  })
})
