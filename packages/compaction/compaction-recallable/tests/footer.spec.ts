import { describe, expect, it } from 'vitest'
import { composeRecallFooter } from '../src/footer.ts'
import { frameRecallableSummary } from '../src/summarizer.ts'

describe('@maple/compaction-recallable footer', () => {
  it('composes deterministic checkpoint footers from summary seq and shadowed range', () => {
    expect(composeRecallFooter(12, { start: 4, end: 9 })).toBe(
      '[checkpoint c12: shadows conversation span #4–#9; originals retrievable via history_read]',
    )
  })

  it('frames summaries with the basic checkpoint tags and recall footer', () => {
    const framed = frameRecallableSummary(
      [{ type: 'text', text: 'Configured database port 5432.' }],
      20,
      { start: 4, end: 8 },
    )
    const text = framed.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('<compacted-summary>')
    expect(text).toContain('Configured database port 5432.')
    expect(text).toContain('[checkpoint c20: shadows conversation span #4–#8; originals retrievable via history_read]')
  })
})
