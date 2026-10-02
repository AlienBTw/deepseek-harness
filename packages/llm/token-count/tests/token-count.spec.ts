import { describe, expect, it } from 'vitest'
import { estimateTokensExact, tokenCount } from '@maple/token-count'

describe('@maple/token-count', () => {
  it('counts ASCII and CJK with cl100k_base', () => {
    expect(estimateTokensExact('')).toBe(0)
    expect(estimateTokensExact('abcd')).toBe(1)
    expect(estimateTokensExact('你好世界')).toBe(5)
    expect(estimateTokensExact('你好世界')).toBeGreaterThan(Math.ceil('你好世界'.length / 4))
  })

  it('uses exact counts under 200 chars and samples longer text', () => {
    const short = 'line\n'.repeat(10)
    expect(tokenCount(short)).toBe(estimateTokensExact(short))
    const long = 'line\n'.repeat(400)
    expect(long.length).toBeGreaterThan(200)
    expect(tokenCount(long)).toBeGreaterThan(0)
  })
})
