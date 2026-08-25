/**
 * Focused invariant coverage for @maple/context-repo-map. The file name keeps
 * the global test host out of this root so the companion topology is explicit.
 */

import { createUserMessage } from '@maple/llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@maple/cordis'
import type { ContentBlock } from '@maple/llm'
import SessionStore, { Session, SessionId, type SessionEvent } from '@maple/session'
import InvariantRegistry from '@maple/invariants'
import * as RepoMapInvariant from '../src/invariant.ts'

const HEADER = '=== REPOSITORY MAP (AST Structure & Key Symbols) ==='
const GOOD_TEXT = `${HEADER}\nsrc/math.ts\n  function add(a: number, b: number): number`

function sourceFor(text: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'plugin',
    plugin: 'repo-map',
    form: 'snapshot',
    sections: [{ name: 'repo-map', text }],
    ...overrides,
  }
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(RepoMapInvariant)
  return ctx
}

function mapData(
  text: string,
  blocks?: ContentBlock[],
  source?: Record<string, unknown>,
): SessionEvent<'user/message'>['data'] {
  return createUserMessage({
    content: blocks ?? [{ type: 'text', text }],
    source: (source ?? sourceFor(text)) as never,
  })
}

function mapEvent(data: SessionEvent<'user/message'>['data']): SessionEvent<'user/message'> {
  return { type: 'user/message', seq: 0, time: Date.parse('2026-08-24T00:00:00Z'), data }
}

function openTurnSession(id: string): Session {
  const session = Session.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'turn 1' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  return session
}

function closedTurnSession(id: string): Session {
  const session = Session.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return session
}

describe('repo-map invariants', () => {
  it('exposes the Loader-safe face and accepts a well-formed durable map', async () => {
    expect(RepoMapInvariant.name).toBe('repo-map-invariant')
    expect(RepoMapInvariant.inject).toEqual(['invariants'])
    const ctx = await setup()
    const session = openTurnSession('accepts')
    expect(() => { ctx.emit('session/event', session, mapEvent(mapData(GOOD_TEXT))) }).not.toThrow()
  })

  it('rejects a map message whose content is not exactly one text block', async () => {
    const ctx = await setup()
    const data = mapData(GOOD_TEXT, [
      { type: 'text', text: GOOD_TEXT },
      { type: 'text', text: 'second block' },
    ])
    expect(() => { ctx.emit('session/event', openTurnSession('two-blocks'), mapEvent(data)) })
      .toThrow(/exactly one text block/)
  })

  it('rejects a map message missing the package-owned header line', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('session/event', openTurnSession('no-header'), mapEvent(mapData('plain prose'))) })
      .toThrow(/package-owned header line/)
  })

  it('rejects a map whose leading content block is not an object', async () => {
    const ctx = await setup()
    const data = mapData(GOOD_TEXT, ['just a string' as unknown as ContentBlock])
    expect(() => { ctx.emit('session/event', openTurnSession('string-block'), mapEvent(data)) })
      .toThrow(/exactly one text block/)
  })

  it('leaves foreign plugin attributions outside package ownership', async () => {
    const ctx = await setup()
    const session = openTurnSession('foreign')
    // The dispatch filter selects only repo-map-owned events, so another
    // plugin's snapshot is not this companion's concern.
    expect(() => { ctx.emit('session/event', session, mapEvent(mapData(GOOD_TEXT, undefined, {
      kind: 'plugin',
      plugin: 'someone-else',
      form: 'snapshot',
      sections: [{ name: 'someone-else', text: GOOD_TEXT }],
    }))) }).not.toThrow()
  })

  it.each([
    ['a delta form', (): Record<string, unknown> => ({ ...sourceFor(GOOD_TEXT), form: 'delta' })],
    ['an oversized section list', (): Record<string, unknown> => ({
      ...sourceFor(GOOD_TEXT),
      sections: [
        { name: 'repo-map', text: GOOD_TEXT },
        { name: 'more', text: 'x' },
      ],
    })],
    ['section text differing from the message body', (): Record<string, unknown> => ({
      ...sourceFor(GOOD_TEXT),
      sections: [{ name: 'repo-map', text: 'different' }],
    })],
    ['a section carrying another plugin name', (): Record<string, unknown> => ({
      ...sourceFor(GOOD_TEXT),
      sections: [{ name: 'other', text: GOOD_TEXT }],
    })],
    ['a source with no sections member at all', (): Record<string, unknown> => {
      const { sections: _omitted, ...rest } = sourceFor(GOOD_TEXT)
      return rest
    }],
  ] as const)('rejects %s', async (_label, buildSource) => {
    const ctx = await setup()
    const id = SessionId(`bad-source-${Math.random().toString(36).slice(2)}`)
    expect(() => {
      ctx.emit(
        'session/event',
        openTurnSession(id),
        mapEvent(mapData(GOOD_TEXT, undefined, buildSource())),
      )
    }).toThrow(/exact snapshot text/)
  })

  it('rejects a map appended outside an open turn', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('session/event', closedTurnSession('closed-turn'), mapEvent(mapData(GOOD_TEXT))) })
      .toThrow(/open turn/)
  })

  it('validates maps already present in the store when the companion installs', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const stored = ctx.sessions.create(SessionId('preexisting-bad'))
    stored.append('turn/start', { turn: 1 })
    stored.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    stored.append('user/message', mapData(GOOD_TEXT), { surfaceOp: 'append' })
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(RepoMapInvariant)).rejects.toThrow(/open turn/)
  })

  it('validates maps inside sessions created after the companion installed', async () => {
    const ctx = await setup()
    const id = SessionId('created-later')
    const session = ctx.sessions.create(id)
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'turn 1' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(() => session.append('user/message', mapData(GOOD_TEXT), { surfaceOp: 'append' })).not.toThrow()

    const badId = SessionId('created-later-bad')
    const bad = ctx.sessions.create(badId)
    bad.append('turn/start', { turn: 1 })
    bad.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'turn 1' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(() => bad.append('user/message', mapData('missing header'), { surfaceOp: 'append' }))
      .toThrow(/package-owned header line/)
  })
})
