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
import * as ToolRecall from '@maple/tool-recall'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('real Loader composition', () => {
  it('loads tool-recall and registers history tools', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-tool-recall-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@maple/agent'",
      "- name: '@maple/system-prompt'",
      "- name: '@maple/tools'",
      "- name: '@maple/tool-recall'",
      '  config:',
      '    maxPageLines: 50',
      '    defaultSearchLimit: 5',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        const modules = new Map<string, unknown>([
          ['@maple/agent', AgentRegistry],
          ['@maple/system-prompt', SystemPrompt],
          ['@maple/tools', ToolRuntime],
          ['@maple/tool-recall', ToolRecall],
        ])
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    const schemas = context.tools.schemas()
    expect(schemas.some(schema => schema.name === 'history_read')).toBe(true)
    expect(schemas.some(schema => schema.name === 'history_search')).toBe(true)
    expect(schemas.find(schema => schema.name === 'history_read')?.description).toContain('checkpoint')
  })

  it('rejects non-integer defaultSearchLimit during plugin load', async () => {
    context = new Context()
    await context.plugin(AgentRegistry)
    await context.plugin(SystemPrompt)
    await context.plugin(ToolRuntime)
    try {
      await context.plugin(ToolRecall, {
        defaultSearchLimit: 'five',
      } as never)
      expect.unreachable('expected plugin load to reject invalid config')
    } catch (error: unknown) {
      expect(String(error)).toMatch(/defaultSearchLimit/)
    }
  })
})
