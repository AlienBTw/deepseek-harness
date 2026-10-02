/**
 * Interactive side sessions: completed-turn fork, hard read-only deny, merge-back.
 * @module @maple/sidechat
 */

import { Context, Service } from '@maple/cordis'
import z from '@maple/schemastery'
import type { Agent, AgentHandle, CreateAgentOptions } from '@maple/agent'
import { SessionId } from '@maple/session'
import type { SessionEvent, UserMessage } from '@maple/session'
import type { PreToolDecision, ToolExecution } from '@maple/tools'
import {
  DEFAULT_MERGE_MAX_CHARS,
  SIDECHAT_READONLY_DENY_REASON,
  advisorFramingMessage,
  capMergeNote,
  mergeBackMessage,
} from './framing.ts'
import { completedTurnSeedLength, latestAssistantText } from './seed.ts'

export {
  ADVISOR_FRAMING_TEXT,
  DEFAULT_MERGE_MAX_CHARS,
  SIDECHAT_PLUGIN,
  SIDECHAT_READONLY_DENY_REASON,
  advisorFramingMessage,
  capMergeNote,
  mergeBackMessage,
} from './framing.ts'
export { completedTurnSeedLength, latestAssistantText } from './seed.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'sidechat'

/** Plugin config: deployment-varying merge-back length cap. */
export interface Config {
  /**
   * Maximum characters retained in one merge-back note (default 2000).
   * Bounds each handback; repeated merges still consume parent context.
   */
  mergeMaxChars?: number
}

export const Config: z<Config> = z.object({
  mergeMaxChars: z.number().step(1).min(1).default(DEFAULT_MERGE_MAX_CHARS),
})

declare module '@maple/cordis' {
  interface Context {
    sidechat: SidechatService
  }
}

/** Options for {@link SidechatService.fork}. */
export interface SidechatForkOptions {
  /** Optional child session id; generated when omitted. */
  readonly sessionId?: SessionId
  /**
   * Inclusive seq anchor inside the desired completed turn. Omitted or
   * past-end anchors use the source's last completed turn.
   */
  readonly atSeq?: number
  /** Extra agent-create options excluding seed/meta/sessionId owned here. */
  readonly agentOptions?: CreateAgentOptions['agentOptions']
  /** Extra setup composed after sidechat publication. */
  readonly setup?: CreateAgentOptions['setup']
}

/**
 * Failure when a side-session fork cannot select a completed-turn prefix.
 */
export class SidechatForkError extends Error {
  readonly code = 'SIDECHAT_FORK_UNAVAILABLE' as const
  constructor(message: string) {
    super(message)
    this.name = 'SidechatForkError'
  }
}

/**
 * Failure when merge-back lacks a usable note.
 */
export class SidechatMergeError extends Error {
  readonly code = 'SIDECHAT_MERGE_INVALID' as const
  constructor(message: string) {
    super(message)
    this.name = 'SidechatMergeError'
  }
}

/**
 * Host-facing side-session mechanics: fork an advisor child, merge a capped
 * note back into the parent, and enforce read-only tool execution.
 */
export class SidechatService extends Service {
  static inject = ['agents', 'tools']
  static Config = Config

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'sidechat')
    installReadonlyDenyGate(ctx)
  }

  /**
   * Fork `parent` at its balanced completed-turn prefix into a read-only
   * advisor child. Leaves the parent log untouched. Stamps `parentSession`,
   * `seedLength`, and `origin: 'sidechat'`, then appends one advisor framing
   * `user/message` after the seed.
   * @param parent - live source agent.
   * @param options - optional id, cut anchor, and agent create options.
   * @returns the published child handle.
   */
  async fork(parent: Agent, options: SidechatForkOptions = {}): Promise<AgentHandle> {
    const events = parent.session.events
    const cut = completedTurnSeedLength(events, options.atSeq)
    if (cut === undefined) {
      throw new SidechatForkError(
        options.atSeq === undefined
          ? `session "${parent.id}" has no completed turn to fork from`
          : `session "${parent.id}" has not completed the turn containing event ${String(options.atSeq)}`,
      )
    }
    const seed = events.slice(0, cut) as SessionEvent[]
    const sessionId = options.sessionId ?? SessionId(`sidechat-${crypto.randomUUID()}`)
    const header = parent.session.header
    const handle = await this.ctx.agents.create({
      sessionId,
      seed,
      meta: {
        ...header.cwd === undefined ? {} : { cwd: header.cwd },
        parentSession: parent.id,
        seedLength: cut,
        origin: 'sidechat',
        ...header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset },
      },
      agentOptions: options.agentOptions ?? { ...parent.options },
      ...options.setup === undefined ? {} : { setup: options.setup },
    })
    handle.agent.session.append('user/message', advisorFramingMessage(), { surfaceOp: 'append' })
    return handle
  }

  /**
   * Inject one length-capped merge-back note into `parent`. When `note` is
   * omitted, uses the child's latest assistant text.
   * @param parent - live parent agent that receives the handback.
   * @param child - side-session agent supplying the optional default note.
   * @param note - explicit handback text; overrides the child's latest assistant text.
   * @returns the durable message appended to the parent.
   */
  mergeBack(parent: Agent, child: Agent, note?: string): UserMessage {
    if (child.session.header.origin !== 'sidechat') {
      throw new SidechatMergeError(`session "${child.id}" is not a sidechat advisor`)
    }
    if (child.session.header.parentSession !== parent.id) {
      throw new SidechatMergeError(
        `session "${child.id}" parentSession does not match parent "${parent.id}"`,
      )
    }
    const raw = note ?? latestAssistantText(child.session.events)
    if (raw === undefined || raw.trim().length === 0) {
      throw new SidechatMergeError('merge-back requires a non-empty note or child assistant text')
    }
    const capped = capMergeNote(raw, this.config.mergeMaxChars ?? DEFAULT_MERGE_MAX_CHARS)
    const message = mergeBackMessage(capped)
    parent.session.append('user/message', message, { surfaceOp: 'append' })
    return message
  }
}

/**
 * Deny mutating tools for sidechat-origin agents via `tools/pre-execute`.
 * Read-only tools are those whose visible definition returns exact
 * `isConcurrencySafe === true` (execution mode `parallel`).
 * @param ctx - Cordis context with `tools`.
 */
function installReadonlyDenyGate(ctx: Context): void {
  ctx.on('tools/pre-execute', (exec: ToolExecution, next: () => Promise<PreToolDecision>) => {
    if (exec.agent?.session.header.origin !== 'sidechat') return next()
    if (ctx.tools.executionMode(exec).kind === 'parallel') return next()
    return Promise.resolve({ kind: 'deny' as const, reason: SIDECHAT_READONLY_DENY_REASON })
  })
}

export default SidechatService
