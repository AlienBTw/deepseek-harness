import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@maple/cordis'
import Loader from '@maple/cordis-plugin-loader'
import Include from '@maple/cordis-plugin-include'
import LlmRuntime from '@maple/llm'
import SessionStore from '@maple/session'
import TokenMeter from '@maple/token-meter'
import RecallableCompactionEngine from '@maple/compaction-recallable'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('real Loader composition', () => {
  it('loads recallable compaction as the compaction service', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-compaction-recallable-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@maple/llm'",
      "- name: '@maple/session'",
      "- name: '@maple/token-meter'",
      "- name: '@maple/compaction-recallable'",
      '  config:',
      '    thresholdRatio: 0.5',
      '    retainRatio: 0.125',
      '    auto: false',
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
          ['@maple/llm', LlmRuntime],
          ['@maple/session', SessionStore],
          ['@maple/token-meter', TokenMeter],
          ['@maple/compaction-recallable', RecallableCompactionEngine],
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

    expect(context.get('compaction')).toBeInstanceOf(RecallableCompactionEngine)
    expect((context.compaction as unknown as RecallableCompactionEngine).config).toMatchObject({
      thresholdRatio: 0.5,
      retainRatio: 0.125,
      auto: false,
    })
  })
})
