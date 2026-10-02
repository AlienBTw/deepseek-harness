/**
 * Load-time validation for recallable compaction budgets layered on basic config.
 * @module @maple/compaction-recallable/config
 */

import { deepFreeze } from '@maple/llm'
import type { LlmCallConfig } from '@maple/llm'
import {
  resolveConfig as resolveBasicConfig,
  resolveTargetPolicy as resolveBasicTargetPolicy,
  resolveCompactSpec as resolveBasicCompactSpec,
  TargetPressureConfigError,
} from '@maple/compaction-basic/src/config.ts'
import type {
  RecallableCompactionConfig,
  ResolvedCompactSpec,
  ResolvedConfig,
  ResolvedTargetPolicy,
} from './types.ts'

export { TargetPressureConfigError }

/** Default stub-chunk budget before the trailing state slice. */
const DEFAULT_CHUNK_TOKENS = 2048

/** Default soft stub generation budget. */
const DEFAULT_STUB_TOKENS = 256

/** Maximum stubTokens/chunkTokens ratio accepted at load. */
const MAX_STUB_CHUNK_RATIO = 0.25

/**
 * Resolve and validate recallable defaults on top of basic compaction config.
 * @param config - untrusted plugin configuration after Loader normalization.
 * @returns detached immutable recallable configuration.
 */
export function resolveConfig(config: RecallableCompactionConfig = {}): ResolvedConfig {
  const { chunkTokens: rawChunk, stubTokens: rawStub, ...basic } = config
  const resolvedBasic = resolveBasicConfig(basic)
  const chunkTokens = rawChunk ?? DEFAULT_CHUNK_TOKENS
  const stubTokens = rawStub ?? DEFAULT_STUB_TOKENS
  validateBudgets(chunkTokens, stubTokens, 'RecallableCompactionConfig')
  return deepFreeze({
    ...resolvedBasic,
    chunkTokens,
    stubTokens,
  })
}

/**
 * Merge the exact provider/model override over the validated default policy.
 * @param config - validated service defaults and override table.
 * @param target - exact durable provider/model route to match.
 * @returns detached immutable policy before model-capacity scaling.
 */
export function resolveTargetPolicy(
  config: ResolvedConfig,
  target: Pick<LlmCallConfig, 'provider' | 'model'>,
): ResolvedTargetPolicy {
  const basic = resolveBasicTargetPolicy(config, target)
  return deepFreeze({
    ...basic,
    chunkTokens: config.chunkTokens,
    stubTokens: config.stubTokens,
  })
}

/**
 * Scale a merged target policy against one model's context capacity.
 * @param policy - merged target policy.
 * @param contextWindow - model context window in tokens.
 * @returns concrete pressure, retention, and chunk budgets.
 */
export function resolveCompactSpec(
  policy: ResolvedTargetPolicy,
  contextWindow: number,
): ResolvedCompactSpec {
  const basic = resolveBasicCompactSpec(policy, contextWindow)
  return deepFreeze({
    ...basic,
    chunkTokens: policy.chunkTokens,
    stubTokens: policy.stubTokens,
  })
}

/** Reject non-positive or ratio-invalid stub/chunk budgets. */
function validateBudgets(chunkTokens: number, stubTokens: number, label: string): void {
  if (!Number.isSafeInteger(chunkTokens) || chunkTokens < 1) {
    throw new Error(`${label}: chunkTokens must be a positive safe integer`)
  }
  if (!Number.isSafeInteger(stubTokens) || stubTokens < 1) {
    throw new Error(`${label}: stubTokens must be a positive safe integer`)
  }
  if (stubTokens >= chunkTokens) {
    throw new Error(`${label}: stubTokens must be strictly less than chunkTokens`)
  }
  if (stubTokens / chunkTokens > MAX_STUB_CHUNK_RATIO) {
    throw new Error(
      `${label}: stubTokens/chunkTokens ratio must be <= ${MAX_STUB_CHUNK_RATIO}`,
    )
  }
}
