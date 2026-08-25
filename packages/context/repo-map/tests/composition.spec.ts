/**
 * Real-composition guard for repo-map: the plugin boots from a test-only
 * cordis.yml through the actual Loader + Include path, and its agent/pre-step
 * listener injects one durable, model-visible repository map extracted by the
 * real Tree-Sitter grammar path over a fixture workspace. Unit coverage pins
 * the tag-less-file filter that decides which files render as bare sentinels.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@maple/cordis'
import Loader from '@maple/cordis-plugin-loader'
import Include from '@maple/cordis-plugin-include'
import { createUserMessage } from '@maple/llm'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionEvent } from '@maple/session'
import AgentRegistry, { agentEvents, Inbox, type Agent } from '@maple/agent'
import { buildGraph, buildRankedTags } from '../src/graph.ts'
import * as repoMap from '../src/index.ts'
import type { Tag } from '../src/types.ts'

const SIGNAL = new AbortController().signal

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function writeFixtureWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'repo-map-composition-'))
  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(
    join(workspace, 'src', 'math.ts'),
    'export function add(a: number, b: number): number {\n  return a + b\n}\n',
  )
  await writeFile(
    join(workspace, 'src', 'main.ts'),
    "import { add } from './math'\n\nexport function main(): number {\n  return add(1, 2)\n}\n",
  )
  // A file whose language yields no tags: the tag-less-file sentinel path.
  await writeFile(join(workspace, 'NOTES.md'), '# scratch notes\n\nnothing parseable here\n')
  return workspace
}

async function loadComposition(): Promise<Context> {
  const workspace = await writeFixtureWorkspace()
  root = workspace
  const configPath = join(workspace, 'composition.cordis.yml')
  await writeFile(configPath, [
    '- id: repo-map',
    "  name: '@maple/context-repo-map'",
    '  config:',
    '    maxTokens: 800',
    '    maxFiles: 100',
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  await ctx.plugin(AgentRegistry)
  ctx.baseUrl = pathToFileURL(workspace).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@maple/context-repo-map', repoMap],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

function workspaceAgent(session: Session): Agent {
  return {
    id: SessionId('repo-map-agent'),
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('repo-map must append directly to the open step') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

function workspaceSession(cwd: string): Session {
  return Session.create(SessionId('repo-map-session'), [], {
    version: SESSION_FORMAT_VERSION,
    id: SessionId('repo-map-session'),
    createdAt: Date.now(),
    cwd,
  })
}

function openTurn(session: Session, turn: number): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `turn ${turn}` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

function proposedMessage() {
  return createUserMessage({
    content: [{ type: 'text', text: 'request proposal' }],
    source: { kind: 'plugin', plugin: 'repo-map-test' },
  })
}

async function firePreStep(agent: Agent, turn: number, step: number) {
  const proposed = proposedMessage()
  const decision = await agentEvents(context!, agent).waterfall(
    'agent/pre-step',
    { messages: [proposed], turn, step, signal: SIGNAL },
    () => Promise.resolve({ kind: 'enter' as const, messages: [proposed] }),
  )
  if (decision.kind === 'enter') {
    for (const message of decision.messages) {
      if (message === proposed) continue
      agent.session.append('user/message', message, { surfaceOp: 'append' })
    }
  }
  return decision
}

function mapTexts(session: Session): string[] {
  const texts: string[] = []
  for (const event of session.events) {
    if (event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'repo-map') {
      texts.push(event.data.content.find(block => block.type === 'text')?.text ?? '')
    }
  }
  return texts
}

function mapEvents(session: Session): SessionEvent<'user/message'>[] {
  return session.events.filter(
    (event): event is SessionEvent<'user/message'> =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'repo-map')
}

describe('repo-map tag-less-file filter', () => {
  it('sends bare sentinels only for files that own no definitions', () => {
    const mathTag: Tag = { rel_fname: 'src/math.ts', fname: 'src/math.ts', line: 0, name: 'add', kind: 'def' }
    const orphanTag: Tag = { rel_fname: 'src/lonely.ts', fname: 'src/lonely.ts', line: 4, name: 'orphan', kind: 'def' }
    // lonely.ts owns a definition entry but earned no distributed rank;
    // notes.md never produced any tags.
    const rankedDefinitions = new Map([['src/math.ts\u0000add', 5]])
    const definitions = new Map([
      ['src/math.ts\u0000add', [mathTag]],
      ['src/lonely.ts\u0000orphan', [orphanTag]],
    ])
    const nodeRanks = new Map([['src/notes.md', 3], ['src/lonely.ts', 2]])

    const ranked = buildRankedTags(rankedDefinitions, definitions, nodeRanks, new Set(), new Set(['src/math.ts', 'src/lonely.ts', 'src/notes.md']))

    expect(ranked).toEqual([
      { type: 'tag', tag: mathTag },
      { type: 'file', fname: 'src/notes.md' },
    ])
  })

  it('keeps chat-file sentinels out and orders tag-less files by node rank', () => {
    const nodeRanks = new Map([['b.md', 9], ['a.md', 1]])
    const ranked = buildRankedTags(new Map(), new Map(), nodeRanks, new Set(), new Set(['a.md', 'b.md']))
    expect(ranked.map(entry => entry.type === 'file' ? entry.fname : entry.tag.rel_fname)).toEqual(['b.md', 'a.md'])
  })

  it('treats a malformed definition key without a separator as owning no file', () => {
    const nodeRanks = new Map([['stray.ts', 4]])
    // A key with no NUL separator names no owning file, so stray.ts stays
    // eligible for the bare-sentinel path.
    const ranked = buildRankedTags(
      new Map(),
      new Map([['no-separator', [{ rel_fname: 'stray.ts', fname: 'stray.ts', line: 0, name: 'x', kind: 'def' }]]]),
      nodeRanks,
      new Set(),
      new Set(['stray.ts']),
    )
    expect(ranked).toEqual([{ type: 'file', fname: 'stray.ts' }])
  })

  it('personalizes chat and mentioned files with a capped vector and self-edges def-only idents', () => {
    const tag = (relFname: string, name: string, kind: Tag['kind']): Tag =>
      ({ rel_fname: relFname, fname: relFname, line: 0, name, kind })
    const built = buildGraph({
      // helper.ts defines orphan (never referenced): the def-only self-edge arm.
      // user.ts defines and references shared; main.ts references shared.
      tags: [
        tag('helper.ts', 'orphan', 'def'),
        tag('user.ts', 'shared', 'def'),
        tag('user.ts', 'shared', 'ref'),
        tag('main.ts', 'shared', 'ref'),
      ],
      chatRelFnames: new Set(['user.ts']),
      mentionedRelFnames: new Set(['user.ts']),
      mentionedIdents: new Set(['shared']),
    })

    // Chat + mentioned caps at one personalize share; untouched files stay out.
    expect(built.personalization.get('user.ts')).toBeCloseTo(100 / 3)
    expect(built.personalization.has('main.ts')).toBe(false)

    const selfEdges = built.graph.edges.get('helper.ts')
    expect(selfEdges?.get('helper.ts')?.get('orphan')).toBe(0.1)
  })
})

describe('repo-map real Loader composition', () => {
  it('keeps the named-export plugin face the Loader requires', () => {
    expect('default' in repoMap).toBe(false)
    expect(repoMap.name).toBe('repo-map')
    expect(repoMap.inject).toEqual(['agents'])
    expect(repoMap.Config).toBeDefined()
    expect(typeof repoMap.apply).toBe('function')
  })

  it('injects one durable first-step map built from the real grammar path', async () => {
    await loadComposition()
    const workspace = root!
    const session = workspaceSession(workspace)
    const agent = workspaceAgent(session)
    openTurn(session, 1)

    const decision = await firePreStep(agent, 1, 1)

    expect(decision.kind).toBe('enter')
    const events = mapEvents(session)
    expect(events).toHaveLength(1)
    expect(events[0]!.surfaceOp).toBe('append')
    expect(events[0]!.data.source).toMatchObject({
      kind: 'plugin',
      plugin: 'repo-map',
      form: 'snapshot',
      sections: [{ name: 'repo-map' }],
    })
    const text = mapTexts(session)[0]!
    expect(text).toContain('=== REPOSITORY MAP')
    expect(text).toContain('src/math.ts')
    expect(text).toContain('add')

    // Later steps of the same turn stay quiet.
    await firePreStep(agent, 1, 2)
    expect(mapEvents(session)).toHaveLength(1)
  })

  it('re-injects on the first step of each turn', async () => {
    await loadComposition()
    const workspace = root!
    const session = workspaceSession(workspace)
    const agent = workspaceAgent(session)
    openTurn(session, 1)

    await firePreStep(agent, 1, 1)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    openTurn(session, 2)
    await firePreStep(agent, 2, 1)

    expect(mapEvents(session)).toHaveLength(2)
  })

  it('stops injecting after the plugin fiber disposes', async () => {
    const ctx = await loadComposition()
    const workspace = root!
    const session = workspaceSession(workspace)
    const agent = workspaceAgent(session)
    openTurn(session, 1)
    await firePreStep(agent, 1, 1)
    expect(mapEvents(session)).toHaveLength(1)

    await ctx.fiber.dispose()

    const second = await firePreStep(agent, 1, 2)
    if (second.kind !== 'enter') throw new Error('expected enter')
    expect(second.messages).toHaveLength(1)
    expect(mapEvents(session)).toHaveLength(1)
  })
})
