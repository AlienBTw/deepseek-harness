import { describe, expect, it } from 'vitest'
import type { SessionHeader, SessionId } from '@maple/session'
import {
  pageSessionHeaders,
  selectGcVictims,
  sessionActivityAt,
} from '@maple/session-persistence'

function header(
  id: string,
  createdAt: number,
  lastPromptAt?: number,
): SessionHeader {
  return {
    id: id as SessionId,
    version: 0,
    createdAt,
    ...lastPromptAt === undefined ? {} : { lastPromptAt },
  }
}

describe('sessionActivityAt', () => {
  it('prefers lastPromptAt when present', () => {
    expect(sessionActivityAt(header('a', 10, 40))).toBe(40)
    expect(sessionActivityAt(header('a', 10))).toBe(10)
  })
})

describe('pageSessionHeaders', () => {
  it('pages newest-first with a stable keyset cursor', () => {
    const headers = [
      header('a', 1),
      header('b', 3),
      header('c', 2),
      header('d', 4),
    ]
    const first = pageSessionHeaders(headers, { limit: 2 })
    expect(first.items.map(item => item.id)).toEqual(['d', 'b'])
    expect(first.nextCursor).toBeTypeOf('string')
    const second = pageSessionHeaders(headers, {
      limit: 2,
      ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
    })
    expect(second.items.map(item => item.id)).toEqual(['c', 'a'])
    expect(second.nextCursor).toBeUndefined()
  })

  it('rejects a non-positive limit and a malformed cursor', () => {
    expect(() => pageSessionHeaders([], { limit: 0 })).toThrow(/positive safe integer/)
    expect(() => pageSessionHeaders([header('a', 1)], { limit: 1, cursor: '!!!' }))
      .toThrow(/cursor/)
  })
})

describe('selectGcVictims', () => {
  it('deletes aged sessions then trims to maxSessions newest survivors', () => {
    const now = 10_000
    const headers = [
      header('keep-new', now - 1_000),
      header('aged', now - 10 * 86_400_000),
      header('keep-mid', now - 2_000),
      header('trim', now - 3_000),
    ]
    expect(selectGcVictims(headers, { maxAgeDays: 5, maxSessions: 2 }, now))
      .toEqual(['aged', 'trim'])
  })

  it('returns nothing without a policy and rejects invalid ceilings', () => {
    expect(selectGcVictims([header('a', 1)], {}, 10)).toEqual([])
    expect(() => selectGcVictims([], { maxAgeDays: 0 }, 1)).toThrow(/maxAgeDays/)
    expect(() => selectGcVictims([], { maxSessions: -1 }, 1)).toThrow(/maxSessions/)
  })
})
