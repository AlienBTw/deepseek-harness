/**
 * Model validation and normalization for Task Surface models.
 * @module @maple/task-surface/parser
 */

import type {
  TaskSurfaceBlock,
  TaskSurfaceField,
  TaskSurfaceLayout,
  TaskSurfaceModelV1,
  TaskSurfaceOption,
  TaskSurfaceSection,
} from './types.ts'

/** Maximum payload size in serialized bytes for a Task Surface model. */
export const MAX_MODEL_BYTES = 65536 // 64 KiB
/** Maximum number of sections permitted in a single Task Surface model. */
export const MAX_SECTIONS = 32
/** Maximum number of content blocks permitted across all sections. */
export const MAX_BLOCKS = 64
/** Maximum number of interactive input fields permitted in a model. */
export const MAX_FIELDS = 32
/** Maximum number of rows allowed in a table block. */
export const MAX_TABLE_ROWS = 200

const LAYOUTS = new Set<TaskSurfaceLayout>(['stack', 'grid-2', 'grid-3'])

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function parseOption(raw: unknown, label: string): TaskSurfaceOption {
  if (typeof raw !== 'object' || raw === null) throw new Error(`${label} option must be an object`)
  const o = raw as Record<string, unknown>
  const id = requireNonEmptyString(o.id, `${label} option id`)
  const option: TaskSurfaceOption = { id, label: requireNonEmptyString(o.label, `${label} option label`) }
  if (typeof o.description === 'string' && o.description.trim()) {
    option.description = o.description.trim()
  }
  return option
}

function parseBlock(raw: unknown, sectionId: string): TaskSurfaceBlock {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Section "${sectionId}" block must be an object`)
  }
  const b = raw as Record<string, unknown>
  if (typeof b.kind !== 'string') {
    throw new Error(`Section "${sectionId}" block requires kind`)
  }
  switch (b.kind) {
    case 'markdown':
      return { kind: 'markdown', text: requireNonEmptyString(b.text, `Section "${sectionId}" markdown text`) }
    case 'metric':
      return {
        kind: 'metric',
        label: requireNonEmptyString(b.label, `Section "${sectionId}" metric label`),
        value: requireNonEmptyString(b.value, `Section "${sectionId}" metric value`),
        ...(typeof b.hint === 'string' && b.hint.trim() ? { hint: b.hint.trim() } : {}),
      }
    case 'diff':
      return {
        kind: 'diff',
        filename: requireNonEmptyString(b.filename, `Section "${sectionId}" diff filename`),
        original: typeof b.original === 'string' ? b.original : '',
        modified: typeof b.modified === 'string' ? b.modified : '',
      }
    case 'table': {
      if (!Array.isArray(b.headers)) {
        throw new Error(`Section "${sectionId}" table requires headers array`)
      }
      if (!Array.isArray(b.rows)) {
        throw new Error(`Section "${sectionId}" table requires rows array`)
      }
      if (b.rows.length > MAX_TABLE_ROWS) {
        throw new Error(`Section "${sectionId}" table exceeds row limit (${b.rows.length} > ${MAX_TABLE_ROWS})`)
      }
      const headers = b.headers.map((h, i) => requireNonEmptyString(h, `Section "${sectionId}" table header ${i}`))
      const rows = b.rows.map((row, rowIndex) => {
        if (!Array.isArray(row)) {
          throw new Error(`Section "${sectionId}" table row ${rowIndex} must be an array`)
        }
        return row.map((cell, colIndex) => {
          if (typeof cell !== 'string') {
            throw new Error(`Section "${sectionId}" table row ${rowIndex} cell ${colIndex} must be a string`)
          }
          return cell
        })
      })
      return { kind: 'table', headers, rows }
    }
    default:
      throw new Error(`Section "${sectionId}" unsupported block kind: ${String(b.kind)}`)
  }
}

function parseField(raw: unknown): TaskSurfaceField {
  if (typeof raw !== 'object' || raw === null) throw new Error('Field must be an object')
  const field = raw as Record<string, unknown>
  const id = requireNonEmptyString(field.id, 'Field id')
  const label = requireNonEmptyString(field.label, `Field "${id}" label`)
  const required = field.required === true ? true : undefined

  switch (field.kind) {
    case 'text':
      return {
        kind: 'text',
        id,
        label,
        ...(typeof field.placeholder === 'string' && field.placeholder.trim()
          ? { placeholder: field.placeholder.trim() }
          : {}),
        ...(required ? { required } : {}),
      }
    case 'choice': {
      if (!Array.isArray(field.options) || field.options.length === 0) {
        throw new Error(`Field "${id}" choice requires at least one option`)
      }
      return {
        kind: 'choice',
        id,
        label,
        options: field.options.map((o, i) => parseOption(o, `Field "${id}" option ${i}`)),
        ...(field.multiple === true ? { multiple: true } : {}),
        ...(required ? { required } : {}),
      }
    }
    case 'order': {
      if (!Array.isArray(field.items) || field.items.length === 0) {
        throw new Error(`Field "${id}" order requires at least one item`)
      }
      return {
        kind: 'order',
        id,
        label,
        items: field.items.map((o, i) => parseOption(o, `Field "${id}" item ${i}`)),
        ...(required ? { required } : {}),
      }
    }
    default:
      throw new Error(`Field "${id}" unsupported kind: ${String(field.kind)}`)
  }
}

/**
 * Validate and normalize a Task Surface model.
 * @param input - candidate model object.
 * @returns normalized TaskSurfaceModelV1.
 * @throws Error if model violates structural or limit rules.
 */
export function parseTaskSurfaceModel(input: unknown): TaskSurfaceModelV1 {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Task Surface model must be an object')
  }

  const candidate = input as Record<string, unknown>
  if (candidate.version !== 1) {
    throw new Error(`Unsupported Task Surface version: ${String(candidate.version)}`)
  }

  const title = requireNonEmptyString(candidate.title, 'Task Surface title')
  const description = typeof candidate.description === 'string' && candidate.description.trim()
    ? candidate.description.trim()
    : undefined

  if (!Array.isArray(candidate.sections) || candidate.sections.length === 0) {
    throw new Error('Task Surface model must contain at least one section')
  }

  if (candidate.sections.length > MAX_SECTIONS) {
    throw new Error(`Task Surface exceeds section limit (${candidate.sections.length} > ${MAX_SECTIONS})`)
  }

  let blockCount = 0
  const sectionIds = new Set<string>()

  const sections: TaskSurfaceSection[] = candidate.sections.map((sec: unknown) => {
    if (typeof sec !== 'object' || sec === null) throw new Error('Section must be an object')
    const s = sec as Record<string, unknown>
    const id = requireNonEmptyString(s.id, 'Section id')
    if (sectionIds.has(id)) throw new Error(`Duplicate section id: "${id}"`)
    sectionIds.add(id)

    if (!Array.isArray(s.blocks)) throw new Error(`Section "${id}" blocks must be an array`)
    blockCount += s.blocks.length

    const section: TaskSurfaceSection = {
      id,
      blocks: s.blocks.map((block, blockIndex) => parseBlock(block, `${id}[${blockIndex}]`)),
    }
    if (typeof s.title === 'string' && s.title.trim()) {
      section.title = s.title.trim()
    }
    if (s.layout !== undefined && s.layout !== null) {
      if (typeof s.layout !== 'string' || !LAYOUTS.has(s.layout as TaskSurfaceLayout)) {
        throw new Error(`Section "${id}" layout must be stack, grid-2, or grid-3`)
      }
      section.layout = s.layout as TaskSurfaceLayout
    }
    return section
  })

  if (blockCount > MAX_BLOCKS) {
    throw new Error(`Task Surface exceeds block limit (${blockCount} > ${MAX_BLOCKS})`)
  }

  const fieldIds = new Set<string>()
  let fields: TaskSurfaceModelV1['fields'] = undefined

  if (candidate.fields !== undefined) {
    if (!Array.isArray(candidate.fields)) throw new Error('fields must be an array')
    if (candidate.fields.length > MAX_FIELDS) {
      throw new Error(`Task Surface exceeds field limit (${candidate.fields.length} > ${MAX_FIELDS})`)
    }

    fields = candidate.fields.map((f: unknown) => {
      const parsed = parseField(f)
      if (fieldIds.has(parsed.id)) throw new Error(`Duplicate field id: "${parsed.id}"`)
      fieldIds.add(parsed.id)
      return parsed
    })
  }

  if (typeof candidate.submit !== 'object' || candidate.submit === null) {
    throw new Error('Task Surface model requires a submit object')
  }

  const submit = candidate.submit as { label?: unknown }
  const submitLabel = requireNonEmptyString(submit.label, 'Task Surface submit.label')

  const model: TaskSurfaceModelV1 = {
    version: 1,
    title,
    ...(description ? { description } : {}),
    sections,
    ...(fields ? { fields } : {}),
    submit: { label: submitLabel },
  }

  const jsonStr = JSON.stringify(model)
  if (new TextEncoder().encode(jsonStr).byteLength > MAX_MODEL_BYTES) {
    throw new Error(`Task Surface model exceeds byte limit (${MAX_MODEL_BYTES} bytes)`)
  }

  return JSON.parse(jsonStr) as TaskSurfaceModelV1
}
