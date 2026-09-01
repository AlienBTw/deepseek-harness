import { describe, expect, it } from 'vitest'
import { parseTaskSurfaceModel } from '../src/parser.ts'

describe('parseTaskSurfaceModel', () => {
  it('parses and normalizes a valid TaskSurfaceModelV1', () => {
    const raw = {
      version: 1,
      title: ' Review Migration Plan ',
      description: ' Please review the plan below ',
      sections: [
        {
          id: 'sec-1',
          title: 'Overview',
          layout: 'stack',
          blocks: [
            { kind: 'markdown', text: 'Plan details...' },
            { kind: 'metric', label: 'Risk', value: 'Low', hint: 'Zero downtime' },
          ],
        },
      ],
      fields: [
        {
          kind: 'choice',
          id: 'strategy',
          label: 'Deployment Strategy',
          options: [
            { id: 'rolling', label: 'Rolling update' },
            { id: 'canary', label: 'Canary' },
          ],
        },
      ],
      submit: { label: ' Confirm & Apply ' },
    }

    const model = parseTaskSurfaceModel(raw)
    expect(model.title).toBe('Review Migration Plan')
    expect(model.description).toBe('Please review the plan below')
    expect(model.submit.label).toBe('Confirm & Apply')
    expect(model.sections).toHaveLength(1)
    expect(model.fields).toHaveLength(1)
  })

  it('rejects unsupported versions', () => {
    expect(() => parseTaskSurfaceModel({ version: 2, title: 'T', sections: [], submit: { label: 'S' } }))
      .toThrow(/Unsupported Task Surface version/)
  })

  it('rejects duplicate section and field IDs', () => {
    const duplicateSections = {
      version: 1,
      title: 'T',
      sections: [
        { id: 's1', blocks: [{ kind: 'markdown', text: 'a' }] },
        { id: 's1', blocks: [{ kind: 'markdown', text: 'b' }] },
      ],
      submit: { label: 'S' },
    }
    expect(() => parseTaskSurfaceModel(duplicateSections)).toThrow(/Duplicate section id/)

    const duplicateFields = {
      version: 1,
      title: 'T',
      sections: [{ id: 's1', blocks: [{ kind: 'markdown', text: 'a' }] }],
      fields: [
        { kind: 'text', id: 'f1', label: 'L1' },
        { kind: 'text', id: 'f1', label: 'L2' },
      ],
      submit: { label: 'S' },
    }
    expect(() => parseTaskSurfaceModel(duplicateFields)).toThrow(/Duplicate field id/)
  })

  it('rejects unsupported block kinds and invalid diff blocks', () => {
    expect(() => parseTaskSurfaceModel({
      version: 1,
      title: 'T',
      sections: [{ id: 's1', blocks: [{ kind: 'notice', text: 'nope' }] }],
      submit: { label: 'S' },
    })).toThrow(/unsupported block kind/)

    expect(() => parseTaskSurfaceModel({
      version: 1,
      title: 'T',
      sections: [{ id: 's1', blocks: [{ kind: 'diff', before: 'a', after: 'b' }] }],
      submit: { label: 'S' },
    })).toThrow(/diff filename/)
  })
})
