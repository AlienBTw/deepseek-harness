/**
 * Ban wall-clock `setTimeout` in package `tests/` trees outside an allowlist.
 *
 * Event-driven waits live in `@maple/agent-loop-testkit`; new sleeps belong on
 * the allowlist only while migrating, and stale allowlist entries fail closed.
 * See `.agents/notes/implemented/testing/2026-06-11-deterministic-and-stress-testing.md`.
 */

import { readFileSync, globSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const GATE = 'verify-no-settimeout-in-tests'
const ALLOWLIST_PATH = 'scripts/settimeout-test-allowlist.json'
/** Match an identifier-style `setTimeout` call or reference, not comments alone. */
const SETTIMEOUT = /\bsetTimeout\b/
/** Scan every package test tree under packages/<group>/<pkg>/tests. */
const TEST_GLOB = 'packages/*/*/tests/**/*.{ts,tsx}'

interface AllowlistDocument {
  allowlist?: unknown
}

function repoPath(relative: string): string {
  return relative.split(sep).join('/')
}

function loadAllowlist(): Set<string> {
  const raw = JSON.parse(readFileSync(resolve(root, ALLOWLIST_PATH), 'utf8')) as AllowlistDocument
  if (!Array.isArray(raw.allowlist) || !raw.allowlist.every(entry => typeof entry === 'string')) {
    throw new Error(`${GATE}: ${ALLOWLIST_PATH} must contain a string[] allowlist field`)
  }
  return new Set(raw.allowlist.map(entry => entry.split(sep).join('/')))
}

const allowlist = loadAllowlist()
const testFiles = globSync(TEST_GLOB, { cwd: root })
  .map(repoPath)
  .sort()

const failures: string[] = []
const usedAllowlist = new Set<string>()

for (const relative of testFiles) {
  const text = readFileSync(resolve(root, relative), 'utf8')
  if (!SETTIMEOUT.test(text)) continue
  if (allowlist.has(relative)) {
    usedAllowlist.add(relative)
    continue
  }
  failures.push(
    `${relative}: mentions setTimeout — replace with @maple/agent-loop-testkit wait helpers `
      + `(or add to ${ALLOWLIST_PATH} only while migrating)`,
  )
}

for (const entry of [...allowlist].sort()) {
  if (usedAllowlist.has(entry)) continue
  failures.push(
    `${ALLOWLIST_PATH}: stale allowlist entry ${entry} — file has no setTimeout (or is missing); remove it`,
  )
}

if (failures.length === 0) {
  console.log(
    `${GATE}: ${String(testFiles.length)} test file(s) scanned; `
      + `${String(usedAllowlist.size)} allowlisted setTimeout use(s); ok.`,
  )
  process.exit(0)
}

console.error(`${GATE}: ${String(failures.length)} violation(s):`)
for (const failure of failures) console.error(`  ${failure}`)
process.exit(1)
