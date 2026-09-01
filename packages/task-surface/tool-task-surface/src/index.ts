/**
 * Model-facing show_task_surface tool.
 * Publishes declarative task surfaces for structured user interaction.
 * @module @maple/tool-task-surface
 */

import type { Context } from '@maple/cordis'
import { defineTool } from '@maple/tools'
import type { JsonValue } from '@maple/session/types'
import { parseTaskSurfaceModel, TaskSurfaceId, type TaskSurfaceModelV1 } from '@maple/task-surface'

export const name = 'tool-task-surface'
export const inject = ['tools', 'taskSurface']

/**
 * Register the show_task_surface tool on ctx.tools.
 * @param ctx - registrant Cordis context.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'show_task_surface',
      description:
        'Display a structured, interactive Task Surface in the user interface (forms, choices, '
        + 'tables, metrics, diff reviews, or ordering lists). Calling this tool concludes the current turn '
        + 'and waits for the user to submit their input or decision.',
      parameters: {
        model: {
          type: 'object',
          required: true,
          additionalProperties: true,
          description: 'The complete TaskSurfaceModelV1 declarative structure.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            surfaceId: { type: 'string', required: true },
            title: { type: 'string', required: true },
          },
        },
        render: (_args, value: { surfaceId: string; title: string }) => [{
          type: 'text',
          text: `Rendered Task Surface: "${value.title}" (id: ${value.surfaceId}). Awaiting user submission.`,
        }],
        presentationMeta: (_args, value: { surfaceId: string; title: string; model?: TaskSurfaceModelV1 }): JsonValue => {
          const model = value.model ?? { version: 1 as const, title: value.title, sections: [], submit: { label: 'Submit' } }
          return {
            kind: 'dsh/task-surface',
            version: 1,
            surfaceId: value.surfaceId,
            model: JSON.parse(JSON.stringify(model)) as JsonValue,
          }
        },
      },
      execute: (args, exec) => {
        if (!exec.agent) {
          return Promise.reject(new Error('show_task_surface requires an active agent session'))
        }
        const active = ctx.taskSurface.getActive({ session: exec.agent.session })
        if (active.active) {
          return Promise.reject(new Error('A Task Surface is already open; submit, dismiss, or bypass before opening another'))
        }

        const model = parseTaskSurfaceModel(args.model)
        const surfaceId = TaskSurfaceId(`surface-${Date.now()}-${crypto.randomUUID()}`)

        exec.concludeTurn()

        return Promise.resolve({
          surfaceId,
          title: model.title,
          model: model as unknown as Record<string, JsonValue>,
        })
      },
      presentCall: (args) => {
        const title = typeof args.model['title'] === 'string'
          ? args.model['title']
          : 'Task Surface'
        return {
          card: 'generic',
          title: `Show Task Surface: ${title}`,
          kind: 'other',
          rawInput: args,
        }
      },
    }),
  )
}
