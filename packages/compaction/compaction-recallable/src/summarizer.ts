/**
 * Recallable checkpoint framing and stub/state summarization directives.
 * @module @maple/compaction-recallable/summarizer
 */

import type { Context } from '@maple/cordis'
import { contentHasImage, createUserMessage, BlockAssembler, LlmError } from '@maple/llm'
import type {
  ContentBlock, FinishReason, GenerateOptions, Message, TokenUsage, ToolSchema,
} from '@maple/llm'
import type { Agent } from '@maple/agent'
import type { SummarizationInput, SummaryResult } from '@maple/compaction-basic/src/summarizer.ts'
import { composeRecallFooter, type ShadowedRange } from './footer.ts'
import type { CheckpointKind } from './types.ts'

/** Tags wrapping a frozen index stub. */
const STUB_OPEN_TAG = '<compacted-index-stub>'
const STUB_CLOSE_TAG = '</compacted-index-stub>'

/** Tags wrapping the mutable state checkpoint (same vocabulary as basic). */
const STATE_OPEN_TAG = '<compacted-summary>'
const STATE_CLOSE_TAG = '</compacted-summary>'

const STUB_PREAMBLE =
  'This is an automatically generated index stub for an earlier conversation span. '
  + 'Treat it as a frozen directory card: use history_read on its checkpoint id when you need exact details.'

const STATE_PREAMBLE =
  'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. '
  + 'Treat the captured context as established background and build on it without restating it. '
  + 'Continue the task directly from the messages that follow, without acknowledging this checkpoint.'

const STUB_INSTRUCTION = [
  'You are drafting a frozen INDEX STUB for the conversation slice ABOVE.',
  'Output EXACTLY:',
  '1. Two or three terse lines naming what happened in this slice.',
  '2. One keyword line of low-frequency literal anchors (exact errors, values, config keys), grouped by kind.',
  'Do NOT write a full working-memory summary. Do NOT call tools. Output only the stub text.',
].join('\n')

const STATE_INSTRUCTION = [
  'You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured STATE checkpoint that lets another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  '## Primary Request and Intent',
  "- [the user's original and evolving goals; quote verbatim where the exact wording matters]",
  '',
  '## Key Technical Concepts',
  '- [technologies, frameworks, patterns, and conventions in play]',
  '',
  '## Files and Code',
  '- [exact path: why it matters, key changes or snippets]',
  '',
  '## Errors and Fixes',
  '- [error: how it was resolved, plus any related user feedback]',
  '',
  '## Pending Jobs',
  '- [explicitly requested work not yet completed]',
  '',
  '## Current Work',
  '- [precisely what was in progress at this checkpoint]',
  '',
  '## Next Step',
  '- [the single next action, directly in line with the most recent request, or "(none)"]',
  '',
  '## Critical Context',
  '- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]',
  '',
  'Rules:',
  '- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.',
  '- Capture user feedback and explicit instructions faithfully, especially corrections.',
  '- MERGE, do not restate: if a PRIOR state checkpoint appears above, preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary.',
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Output only the checkpoint text: do not call any tool or take any other action.',
].join('\n')

interface SummaryConfig {
  readonly summarizationProvider: string
  readonly summarizationModel: string
  readonly maxTokens: number
}

/** Extended summarization input carrying optional shared-prefix background. */
export interface RecallableSummarizationInput extends SummarizationInput {
  /** Pass-start state text shared across sibling stub calls (background only). */
  readonly passStartState?: string
  /** Keyword lines from previously committed stubs in this pass. */
  readonly priorStubKeywords?: readonly string[]
  /** One or two most recent committed stub bodies for chronological continuity. */
  readonly recentStubs?: readonly string[]
  /** Whether this call drafts an index stub or rewrites state. */
  readonly kind: CheckpointKind
}

/**
 * Run a cache-reusing summarization call with stub- or state-specific directives.
 * @param ctx - context providing the LLM service.
 * @param config - resolved backend configuration (maxTokens already stub- or state-scaled).
 * @param input - replayed conversation prefix plus recallable layering.
 * @param agent - supplies routed-model history, fallback model, and session id.
 * @param signal - optional cancellation forwarded to the adapter.
 * @returns safe text-only summary blocks and the exact call envelope and output.
 */
export async function summarizeRecallableWithLlm(
  ctx: Context,
  config: SummaryConfig,
  input: RecallableSummarizationInput,
  agent: Agent,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const latest = agent.session.requestHeader()?.config
  const configured = config.summarizationProvider.length === 0
    ? undefined
    : { provider: config.summarizationProvider, model: config.summarizationModel }
  const agentTarget = agent.options.provider !== undefined
    && agent.options.provider.length > 0
    && agent.options.model !== undefined
    && agent.options.model.length > 0
    ? { provider: agent.options.provider, model: agent.options.model }
    : undefined
  const target = configured ?? latest ?? agentTarget
  if (target === undefined) {
    throw new Error(
      'no provider/model available for summarization: set both RecallableCompactionConfig summarization fields, route one request, or set both AgentOptions fields',
    )
  }

  const background: Message[] = []
  if (input.passStartState !== undefined && input.passStartState.length > 0) {
    background.push(createUserMessage({
      content: [{ type: 'text', text: `Pass-start state checkpoint (background only; do not restate into an index stub):\n${input.passStartState}` }],
      source: { kind: 'plugin', plugin: 'dsh-compaction-recallable' },
    }))
  }
  if (input.priorStubKeywords !== undefined && input.priorStubKeywords.length > 0) {
    background.push(createUserMessage({
      content: [{ type: 'text', text: `Keyword lines from earlier stubs in this pass:\n${input.priorStubKeywords.join('\n')}` }],
      source: { kind: 'plugin', plugin: 'dsh-compaction-recallable' },
    }))
  }
  if (input.recentStubs !== undefined && input.recentStubs.length > 0) {
    background.push(createUserMessage({
      content: [{ type: 'text', text: `Recent committed stubs for continuity:\n${input.recentStubs.join('\n---\n')}` }],
      source: { kind: 'plugin', plugin: 'dsh-compaction-recallable' },
    }))
  }

  const instruction = input.kind === 'index' ? STUB_INSTRUCTION : STATE_INSTRUCTION
  const assembler = new BlockAssembler()
  const messages: Message[] = [
    ...background,
    ...input.messages,
    createUserMessage({
      content: [{ type: 'text', text: instruction }],
      source: { kind: 'plugin', plugin: 'dsh-compaction-recallable' },
    }),
  ]
  const options: GenerateOptions = {
    provider: target.provider,
    model: target.model,
    messages,
    ...input.system === undefined ? {} : { system: input.system },
    ...input.tools === undefined ? {} : { tools: [...input.tools] as ToolSchema[] },
    maxTokens: config.maxTokens,
    sessionId: agent.session.id,
    purpose: 'compaction',
    ...signal === undefined ? {} : { signal },
  }
  for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
  const error = finishError(assembler.finish)
  if (error !== undefined) throw error

  const rawOutput = assembler.blocks()
  const summary = summaryText(rawOutput)
  if (!summary.some(block => block.text.trim().length > 0)) {
    throw new Error('summarization produced no text summary content')
  }
  return {
    summary,
    rawOutput,
    llmStreamCall: true,
    provider: options.provider,
    model: options.model,
    maxTokens: config.maxTokens,
    ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
  }
}

/**
 * Wrap summary blocks with kind-specific framing and a deterministic recall footer.
 * @param summary - safe text-only model or code-composed output.
 * @param summarySeq - seq of the companion `compaction/summary` event.
 * @param shadowedRange - inclusive surface span replaced by the checkpoint.
 * @param kind - index stub or state checkpoint.
 * @returns content for the synthesized replacement user message.
 */
export function frameRecallableSummary(
  summary: readonly ContentBlock[],
  summarySeq: number,
  shadowedRange: ShadowedRange,
  kind: CheckpointKind = 'state',
): ContentBlock[] {
  const footer = composeRecallFooter(summarySeq, shadowedRange)
  if (kind === 'index') {
    return [
      { type: 'text', text: `${STUB_PREAMBLE}\n\n${STUB_OPEN_TAG}` },
      ...summary,
      { type: 'text', text: `${STUB_CLOSE_TAG}\n\n${footer}` },
    ]
  }
  return [
    { type: 'text', text: `${STATE_PREAMBLE}\n\n${STATE_OPEN_TAG}` },
    ...summary,
    { type: 'text', text: `${STATE_CLOSE_TAG}\n\n${footer}` },
  ]
}

/**
 * Build a code-only pointer stub when LLM stub drafting fails or the slice is
 * recalled content that must not re-enter an LLM summarize call.
 * @param shadowedRange - inclusive surface span the pointer names.
 * @returns single text block for the stub body (footer applied at frame time).
 */
export function codeOnlyPointerStub(shadowedRange: ShadowedRange): ContentBlock[] {
  return [{
    type: 'text',
    text: `Pointer stub for conversation span #${shadowedRange.start}–#${shadowedRange.end}; originals retrievable via history_read.`,
  }]
}

/** Extract a single keyword line from stub body text for sibling-call layering. */
export function extractKeywordLine(summary: readonly ContentBlock[]): string {
  const text = summary
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0)
  return lines.at(-1) ?? text.slice(0, 200)
}

/** Flatten summary blocks to plain text for pass-start state background. */
export function summaryPlainText(summary: readonly ContentBlock[]): string {
  return summary
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/** Map a terminal summarization finish to its fail-closed error. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens': {
      const error = new Error('summarization truncated at the token cap (incomplete checkpoint)') as Error & { code?: string }
      error.code = 'MAX_TOKENS'
      return error
    }
    default:
      return undefined
  }
}

/** Reject visual output and keep only text before synthesizing a user message. */
function summaryText(
  blocks: readonly ContentBlock[],
): Array<Extract<ContentBlock, { type: 'text' }>> {
  if (contentHasImage(blocks)) {
    throw new LlmError('compaction summary cannot contain image output', 'UNSUPPORTED_CONTENT')
  }
  return blocks.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
}

export type { TokenUsage }
