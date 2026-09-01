/**
 * Configuration vocabulary for the recallable compaction backend.
 * @module @maple/compaction-recallable/types
 */

import type {
  BasicCompactionConfig,
  CompactionPolicyConfig,
  ModelCompactPolicyConfig,
  ResolvedCompactSpec,
  ResolvedConfig,
  ResolvedRetention,
  ResolvedTargetPolicy,
} from '@maple/compaction-basic/src/types.ts'

/** Recallable compaction configuration; same policy surface as basic compaction. */
export interface RecallableCompactionConfig extends BasicCompactionConfig {}

export type {
  CompactionPolicyConfig,
  ModelCompactPolicyConfig,
  ResolvedCompactSpec,
  ResolvedConfig,
  ResolvedRetention,
  ResolvedTargetPolicy,
}
