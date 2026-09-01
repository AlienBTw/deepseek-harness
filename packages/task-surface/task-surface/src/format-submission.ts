/** Format Task Surface field values into one user-visible submission message. @module @maple/task-surface/format-submission */

import type { TaskSurfaceField, TaskSurfaceModelV1 } from './types.ts'

/**
 * Format submitted field values into deterministic user-visible text.
 * @param model - the active Task Surface model.
 * @param values - field id to submitted value map.
 * @param note - optional free-form note from the user.
 * @returns formatted submission body text.
 */
export function formatTaskSurfaceSubmission(
  model: TaskSurfaceModelV1,
  values: Record<string, unknown>,
  note?: string,
): string {
  const lines = [`[Submitted: ${model.title}]`]
  if (model.fields) {
    for (const field of model.fields) {
      const val = values[field.id]
      if (val !== undefined) {
        lines.push(`- ${field.label}: ${formatFieldValue(field, val)}`)
      } else if (field.required) {
        lines.push(`- ${field.label}: (missing)`)
      }
    }
  }
  if (note?.trim()) {
    lines.push(`Note: ${note.trim()}`)
  }
  return lines.join('\n')
}

function formatFieldValue(field: TaskSurfaceField, value: unknown): string {
  if (field.kind === 'order' && Array.isArray(value)) {
    return value.map(String).join(', ')
  }
  return JSON.stringify(value)
}
