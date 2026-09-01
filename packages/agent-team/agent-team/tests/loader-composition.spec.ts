// REAL-composition: boot agent-team + tool-agent-team through Loader.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@maple/cordis'
import Loader from '@maple/cordis-plugin-loader'
import Include from '@maple/cordis-plugin-include'
import AgentRegistry from '@maple/agent'
import Session from '@maple/session'
import JsonlSessionPersistence from '@maple/session-persistence-jsonl'
import SubagentService from '@maple/subagent'
import SystemPrompt from '@maple/system-prompt'
import ToolRuntime from '@maple/tools'
import TeamService from '@maple/agent-team'
import * as ToolAgentTeam from '@maple/tool-agent-team'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-agent-team-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@maple/session'",
    "- name: '@maple/session-persistence-jsonl'",
    '  config:',
    `    root: ${JSON.stringify(root)}`,
    "- name: '@maple/subagent'",
    "- name: '@maple/agent'",
    "- name: '@maple/system-prompt'",
    "- name: '@maple/tools'",
    "- name: '@maple/agent-team'",
    "- name: '@maple/tool-agent-team'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@maple/session', Session],
    ['@maple/session-persistence-jsonl', JsonlSessionPersistence],
    ['@maple/subagent', SubagentService],
    ['@maple/agent', AgentRegistry],
    ['@maple/system-prompt', SystemPrompt],
    ['@maple/tools', ToolRuntime],
    ['@maple/agent-team', TeamService],
    ['@maple/tool-agent-team', ToolAgentTeam],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      const mod = modules.get(specifier)
      if (mod === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      return mod
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

describe('@maple/agent-team loader composition', () => {
  it('boots agentTeams and mounts tool-agent-team through Loader', async () => {
    const ctx = await boot()
    expect(ctx.agentTeams).toBeDefined()
    expect(ctx.agentTeams.tryMembership).toBeTypeOf('function')
  })
})
