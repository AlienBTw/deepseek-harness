/**
 * Model-facing history_read and history_search recall tools.
 * Enables in-loop retrieval of shadowed conversation history.
 * @module @maple/tool-recall
 */

import type { Context } from '@maple/cordis'
import z from '@maple/schemastery'
import { defineTool } from '@maple/tools'
import type { SessionEvent } from '@maple/session'
import type {} from '@maple/compaction'
import { renderEventToTranscript } from '@maple/session'

export const name = 'tool-recall'
export const inject = ['tools']

/** Recall tool configuration. */
export interface Config {
  /** Maximum lines returned per history_read page. */
  maxPageLines?: number
  /** Default search result snippet limit. */
  defaultSearchLimit?: number
}

export const Config: z<Config> = z.object({
  maxPageLines: z.number().default(200),
  defaultSearchLimit: z.number().default(10),
})

/**
 * Register history recall tools on the given Cordis context.
 * @param ctx - the owning Cordis context with tools service.
 * @param config - recall tool configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const maxLines = config.maxPageLines ?? 200
  const defaultLimit = config.defaultSearchLimit ?? 10

  // 1. history_read tool
  ctx.tools.register(
    defineTool({
      name: 'history_read',
      description:
        'Read the original shadowed conversation span of a compaction checkpoint. '
        + 'Use this when an index checkpoint or prior state summary indicates relevant details '
        + 'were compacted and you need exact historical values, errors, or instructions.',
      parameters: {
        checkpoint: {
          type: 'string',
          required: true,
          description: 'The checkpoint identifier (e.g. "c12" or "12").',
        },
        offset: {
          type: 'integer',
          description: 'Line offset to start reading from for pagination.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string', required: true },
          },
        },
        render: (_args, value: { text: string }) => [{
          type: 'text',
          text: value.text,
        }],
      },
      execute: (args, exec) => {
        if (!exec.agent) {
          return Promise.resolve({
            text: 'Error: history_read requires an active agent session.',
          })
        }

        const checkpoint = args.checkpoint
        const offset = args.offset ?? 0
        const events = exec.agent.session.events
        const seqTarget = Number.parseInt(checkpoint.replace(/^c/i, ''), 10)

        // Locate the matching compaction/summary event
        const summaryEvent = events.find(
          (e): e is SessionEvent & { type: 'compaction/summary' } =>
            e.type === 'compaction/summary' && (e.seq === seqTarget || String(e.seq) === String(seqTarget)),
        )

        if (!summaryEvent) {
          return Promise.resolve({
            text: `Checkpoint "${checkpoint}" not found in session history. Checkpoints appear in footers as [checkpoint c<seq>...].`,
          })
        }

        const { shadowedRange, shadowedSeqs } = summaryEvent.data
        const targetSeqs = new Set(shadowedSeqs)

        const transcriptLines: string[] = []
        for (const event of events) {
          if (targetSeqs.has(event.seq)) {
            const line = renderEventToTranscript(event)
            if (line !== null) {
              transcriptLines.push(`[#${event.seq}] ${line}`)
            }
          }
        }

        const totalLines = transcriptLines.length
        const start = Math.max(0, offset)
        const paged = transcriptLines.slice(start, start + maxLines)
        const nextOffset = start + paged.length < totalLines ? start + paged.length : null

        const header = `--- Checkpoint c${summaryEvent.seq} Shadowed Span (#${shadowedRange.start}–#${shadowedRange.end}) [Lines ${start + 1}-${start + paged.length} of ${totalLines}] ---`
        const footer = nextOffset !== null
          ? `\n--- More lines available. Call history_read(checkpoint: "${checkpoint}", offset: ${nextOffset}) ---`
          : ''

        return Promise.resolve({
          text: `${header}\n\n${paged.join('\n\n')}${footer}`,
        })
      },
      presentCall: args => ({ card: 'generic', title: `Recall checkpoint ${args.checkpoint}`, kind: 'other', rawInput: args }),
    }),
  )

  // 2. history_search tool
  ctx.tools.register(
    defineTool({
      name: 'history_search',
      description:
        'Search across all compacted/shadowed conversation history for a literal string query. '
        + 'Returns matching snippets with checkpoint IDs and event sequence numbers.',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description: 'Literal text query to search for in compacted history.',
        },
        checkpoint: {
          type: 'string',
          description: 'Optional specific checkpoint ID to restrict the search to.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of matching snippets to return.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string', required: true },
          },
        },
        render: (_args, value: { text: string }) => [{
          type: 'text',
          text: value.text,
        }],
      },
      execute: (args, exec) => {
        if (!exec.agent) {
          return Promise.resolve({
            text: 'Error: history_search requires an active agent session.',
          })
        }

        const query = args.query
        const checkpoint = args.checkpoint
        const limit = args.limit ?? defaultLimit

        if (!query.trim()) {
          return Promise.resolve({
            text: 'Search query cannot be empty.',
          })
        }

        const events = exec.agent.session.events
        const summaryEvents = events.filter(
          (e): e is SessionEvent & { type: 'compaction/summary' } => e.type === 'compaction/summary',
        )

        let targetSummaries = summaryEvents
        if (checkpoint) {
          const seqTarget = Number.parseInt(checkpoint.replace(/^c/i, ''), 10)
          targetSummaries = summaryEvents.filter(e => e.seq === seqTarget)
        }

        const shadowedSeqs = new Set<number>()
        const seqToCheckpoint = new Map<number, number>()

        for (const s of targetSummaries) {
          const rangeSeqs = s.data.shadowedSeqs
          for (const seq of rangeSeqs) {
            shadowedSeqs.add(seq)
            seqToCheckpoint.set(seq, s.seq)
          }
        }

        const lowerQuery = query.toLowerCase()
        const matches: Array<{ checkpointId: number; seq: number; snippet: string }> = []

        for (const event of events) {
          if (shadowedSeqs.has(event.seq)) {
            const transcript = renderEventToTranscript(event)
            if (transcript && transcript.toLowerCase().includes(lowerQuery)) {
              const cp = seqToCheckpoint.get(event.seq) ?? 0
              matches.push({
                checkpointId: cp,
                seq: event.seq,
                snippet: transcript.length > 300 ? `${transcript.slice(0, 300)}...` : transcript,
              })
              if (matches.length >= limit) break
            }
          }
        }

        if (matches.length === 0) {
          return Promise.resolve({
            text: `No matches found for "${query}" in shadowed history. (Note: history_search is a literal scan; check checkpoint index summaries or use history_read directly).`,
          })
        }

        const resultLines = matches.map(
          m => `[Checkpoint c${m.checkpointId} | Event #${m.seq}]:\n${m.snippet}`,
        )

        return Promise.resolve({
          text: `Found ${matches.length} matching snippet(s) for "${query}":\n\n${resultLines.join('\n\n---\n\n')}`,
        })
      },
      presentCall: args => ({ card: 'generic', title: `Search compacted history for "${args.query}"`, kind: 'other', rawInput: args }),
    }),
  )
}
