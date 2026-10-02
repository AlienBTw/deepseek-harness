/**
 * Configuration vocabulary for the recallable compaction backend.
 * @module @maple/compaction-recallable/types
 */

import type {
  BasicCompactionConfig,
  CompactionPolicyConfig,
  ModelCompactPolicyConfig,
  ResolvedConfig as BasicResolvedConfig,
  ResolvedRetention,
  ResolvedTargetPolicy as BasicResolvedTargetPolicy,
} from '@maple/compaction-basic/src/types.ts'

/** Checkpoint class written on `compaction/summary` and surface framing. */
export type CheckpointKind = 'index' | 'state'

/**
 * Recallable compaction configuration: basic policy plus stub/chunk budgets.
 * `chunkTokens` and `stubTokens` are required tunables for multi-checkpoint passes.
 */
export interface RecallableCompactionConfig extends BasicCompactionConfig {
  /**
   * Target token budget for each frozen index-stub chunk before the trailing
   * state slice. Defaults to `2048`.
   */
  chunkTokens?: number
  /**
   * Soft generation budget for one index stub (~100–200 tokens of surface text).
   * Defaults to `256`. Must stay below `chunkTokens`.
   */
  stubTokens?: number
}

/** Validated recallable config including chunk/stub budgets. */
export type ResolvedConfig = BasicResolvedConfig & {
  readonly chunkTokens: number
  readonly stubTokens: number
}

/** Merged policy for one routed target, including recallable budgets. */
export type ResolvedTargetPolicy = BasicResolvedTargetPolicy & {
  readonly chunkTokens: number
  readonly stubTokens: number
}

/** Concrete pressure/retention budgets plus recallable chunk/stub caps. */
export type ResolvedCompactSpec = Omit<ResolvedTargetPolicy, 'retainRatio' | 'retainTokens'> & {
  readonly contextWindow: number
  readonly thresholdTokens: number
  readonly retainTokens: number
  readonly chunkTokens: number
  readonly stubTokens: number
}

export type {
  CompactionPolicyConfig,
  ModelCompactPolicyConfig,
  ResolvedRetention,
}
