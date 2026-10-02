/**
 * Shared human-prompt activity predicate and reducer.
 */

import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@maple/llm'
import type { SessionEvent } from '@maple/session'
import {
  foldLastPromptAt,
  isHumanPromptEvent,
  reduceLastPromptAt,
} from '../src/last-activity.ts'

function human(seq: number, time: number): SessionEvent {
  return {
    type: 'user/message',
    seq,
    time,
    data: createUserMessage({
      content: [{ type: 'text', text: 'hi' }],
      source: { kind: 'user' },
    }),
    surfaceOp: 'append',
  }
}

function injected(seq: number, time: number): SessionEvent {
  return {
    type: 'user/message',
    seq,
    time,
    data: createUserMessage({
      content: [{ type: 'text', text: 'notice' }],
      source: { kind: 'plugin', plugin: 'test', form: 'instructions' },
    }),
    surfaceOp: 'append',
  }
}

describe('last-activity predicate', () => {
  it('accepts only human-authored user/message events', () => {
    expect(isHumanPromptEvent(human(0, 10))).toBe(true)
    expect(isHumanPromptEvent(injected(1, 20))).toBe(false)
    expect(isHumanPromptEvent({ type: 'turn/start', seq: 2, time: 30, data: { turn: 1 } })).toBe(false)
    expect(isHumanPromptEvent({ type: 'session/end-seed', seq: 3, time: 40, data: {} })).toBe(false)
  })

  it('folds the latest human prompt across mixed logs', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      human(1, 100),
      injected(2, 200),
      { type: 'session/end-seed', seq: 3, time: 300, data: {} },
      human(4, 400),
      { type: 'turn/end', seq: 5, time: 500, data: { turn: 1, reason: { kind: 'interrupted' } } },
    ]
    expect(foldLastPromptAt(undefined, events)).toBe(400)
    expect(reduceLastPromptAt(null, human(1, 100))).toBe(100)
    expect(reduceLastPromptAt(100, injected(2, 200))).toBe(100)
    expect(foldLastPromptAt(50, [{ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }])).toBe(50)
    expect(foldLastPromptAt(undefined, [injected(0, 9)])).toBeUndefined()
  })
})
