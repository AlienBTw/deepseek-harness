/**
 * Run `pnpm audit` against the repository lockfile.
 * Scheduled CI and lockfile-touching PRs invoke this via `pnpm run audit:deps`.
 * @module scripts/audit-dependencies
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pnpmInvocation } from './pnpm-invocation.ts'

const ROOT = resolve(import.meta.dirname, '..')

/**
 * Execute `pnpm audit` with the same Node/pnpm entrypoint the lifecycle uses.
 * Fails on critical advisories; high/moderate are tracked via Dependabot PRs.
 * @param root - absolute repository root containing `pnpm-lock.yaml`.
 * @param env - process environment; defaults to `process.env`.
 * @returns the audit process exit code (0 when the lockfile has no advisory hits under the chosen flags).
 */
export function runDependencyAudit(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const invocation = pnpmInvocation(['audit', '--audit-level', 'critical'], env)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: false,
  })
  if (result.error !== undefined) throw result.error
  if (result.status === null) {
    throw new Error(`audit-dependencies: pnpm audit terminated by signal ${String(result.signal)}.`)
  }
  return result.status
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  process.exitCode = runDependencyAudit(ROOT)
}
