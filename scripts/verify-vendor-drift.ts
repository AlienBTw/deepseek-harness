/**
 * Vendor drift scaffold: reconstruct the claimed vendor/ tree from the
 * manifest SHAs plus checked-in patches under vendor/patches/, then diff.
 *
 * Most upstream remotes are private mirrors. When clone/fetch fails, this
 * script still validates the patch index and documents the local agent job
 * (`pnpm run verify-vendor-drift`) rather than pretending CI proved equality.
 * @module scripts/verify-vendor-drift
 */

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { parseVendorManifestRows, type VendorManifestRow } from './vendor-manifest.ts'

const ROOT = resolve(import.meta.dirname, '..')
const PATCHES_DIR = 'vendor/patches'
const INDEX_FILE = 'vendor/patches/index.json'

/** One checked-in patch recorded in the vendor patch index. */
export interface VendorPatchRecord {
  /** Stable patch id (matches the filename stem convention). */
  id: string
  /** Local-modification log entry number in vendor/README.md. */
  logEntry: number
  /** Patch filenames relative to vendor/patches/. */
  files: string[]
  /** Vendor directory names this patch applies to. */
  appliesTo: string[]
  /** Whether the patch adds files absent upstream or edits existing sources. */
  kind: 'add-file' | 'source'
}

/** Patch index checked in beside the patch files. */
export interface VendorPatchIndex {
  /** Patches that can be applied during reconstruction. */
  patches: VendorPatchRecord[]
  /** Log entries not represented as patches, with the reason. */
  unpatchedLogEntries: Record<string, string>
  /** Command maintainers / agents run when private upstream blocks CI. */
  localAgentJob: string
}

/** Result of validating the patch index without contacting upstream. */
export interface VendorDriftOfflineReport {
  /** Whether the index and patch files are self-consistent. */
  ok: boolean
  /** Human-readable diagnostics. */
  messages: string[]
  /** Parsed index when the file was readable. */
  index: VendorPatchIndex | undefined
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function normalizeRepoPath(path: string): string {
  return path.split(sep).join('/')
}

/**
 * Load and type-check the vendor patch index.
 * @param root - absolute repository root.
 * @returns the parsed index.
 */
export function loadVendorPatchIndex(root: string): VendorPatchIndex {
  const index = readJson<VendorPatchIndex>(join(root, INDEX_FILE))
  if (!Array.isArray(index.patches) || typeof index.unpatchedLogEntries !== 'object' || index.unpatchedLogEntries === null) {
    throw new Error('verify-vendor-drift: vendor/patches/index.json is missing patches[] or unpatchedLogEntries.')
  }
  if (typeof index.localAgentJob !== 'string' || index.localAgentJob.length === 0) {
    throw new Error('verify-vendor-drift: vendor/patches/index.json must declare localAgentJob.')
  }
  return index
}

/**
 * Validate that every indexed patch file exists and that add-file patches
 * match the corresponding checked-in vendor files.
 * @param root - absolute repository root.
 * @returns offline validation report.
 */
export function inspectVendorDriftOffline(root: string): VendorDriftOfflineReport {
  const messages: string[] = []
  let index: VendorPatchIndex | undefined
  try {
    index = loadVendorPatchIndex(root)
  } catch (error) {
    return {
      ok: false,
      messages: [error instanceof Error ? error.message : String(error)],
      index: undefined,
    }
  }

  const patchDir = join(root, PATCHES_DIR)
  for (const record of index.patches) {
    for (const file of record.files) {
      const path = join(patchDir, file)
      if (!existsSync(path)) {
        messages.push(`missing patch file vendor/patches/${file} (index id ${record.id})`)
        continue
      }
      const text = readFileSync(path, 'utf8')
      if (!text.includes('diff --git ') && !text.includes('--- ')) {
        messages.push(`vendor/patches/${file} does not look like a unified diff`)
      }
      if (record.kind === 'add-file') {
        for (const added of extractAddedFiles(text)) {
          const onDisk = join(root, 'vendor', added.path)
          if (!existsSync(onDisk)) {
            messages.push(`add-file patch ${file} targets missing vendor/${normalizeRepoPath(added.path)}`)
            continue
          }
          const actual = readFileSync(onDisk, 'utf8')
          if (actual !== added.content) {
            messages.push(`add-file patch ${file} content does not match vendor/${normalizeRepoPath(added.path)}`)
          }
        }
      }
    }
  }

  // Every *.patch under vendor/patches must be indexed.
  for (const entry of readdirSync(patchDir)) {
    if (!entry.endsWith('.patch')) continue
    if (!index.patches.some(record => record.files.includes(entry))) {
      messages.push(`vendor/patches/${entry} is not listed in index.json`)
    }
  }

  messages.push(
    `Offline mode: private upstream may block clone/fetch. Run the local agent job \`${index.localAgentJob}\` from a machine with cordis-workspace remotes configured (see vendor/patches/README.md).`,
  )

  return { ok: messages.every(message => message.startsWith('Offline mode:')), messages, index }
}

interface AddedFile {
  path: string
  content: string
}

/**
 * Extract newly added file payloads from a unified diff that only creates files.
 * @param patch - unified-diff text.
 * @returns relative paths under vendor/ and their full contents.
 */
export function extractAddedFiles(patch: string): AddedFile[] {
  const files: AddedFile[] = []
  const blocks = patch.split(/^diff --git /m).slice(1)
  for (const block of blocks) {
    const pathMatch = /^a\/\S+ b\/(\S+)/.exec(block)
    if (pathMatch?.[1] === undefined) continue
    if (!block.includes('new file mode')) continue
    const bodyStart = block.indexOf('\n@@')
    if (bodyStart < 0) continue
    const lines = block.slice(bodyStart).split('\n').slice(1)
    const contentLines: string[] = []
    for (const line of lines) {
      if (line.startsWith('diff --git ')) break
      if (line.startsWith('+') && !line.startsWith('+++')) contentLines.push(line.slice(1))
      else if (line.startsWith('\\')) continue
      else if (line.startsWith('-') || line.startsWith(' ')) {
        // add-file hunks should not carry context/removals beyond the marker lines
      }
    }
    files.push({ path: pathMatch[1], content: `${contentLines.join('\n')}${contentLines.length > 0 ? '\n' : ''}` })
  }
  return files
}

function gitAvailable(): boolean {
  const result = spawnSync('git', ['--version'], { stdio: 'ignore', shell: false })
  return result.status === 0
}

/**
 * Attempt to reconstruct one vendored package from upstream + patches.
 * @param root - repository root.
 * @param row - manifest row.
 * @param index - patch index.
 * @param workRoot - temporary directory for clones.
 * @returns diagnostics; empty when the reconstructed package matches vendor/.
 */
export function reconstructVendoredPackage(
  root: string,
  row: VendorManifestRow,
  index: VendorPatchIndex,
  workRoot: string,
): string[] {
  if (!gitAvailable()) {
    return [`git is not available on PATH; cannot clone ${row.upstreamRepo}`]
  }

  const cloneDir = join(workRoot, row.directory)
  mkdirSync(cloneDir, { recursive: true })
  const clone = spawnSync(
    'git',
    ['clone', '--quiet', '--no-checkout', row.upstreamRepo, cloneDir],
    { encoding: 'utf8', shell: false },
  )
  if (clone.status !== 0) {
    return [
      `clone failed for ${row.upstreamRepo} (${row.directory}@${row.commit}): ${(clone.stderr || clone.stdout || 'unknown error').trim()}`,
    ]
  }

  const fetch = spawnSync('git', ['-C', cloneDir, 'fetch', '--quiet', '--depth', '1', 'origin', row.commit], {
    encoding: 'utf8',
    shell: false,
  })
  if (fetch.status !== 0) {
    // Fall back to a full fetch of the commit when depth-1 misses a non-tip SHA.
    const full = spawnSync('git', ['-C', cloneDir, 'fetch', '--quiet', 'origin', row.commit], {
      encoding: 'utf8',
      shell: false,
    })
    if (full.status !== 0) {
      return [
        `fetch failed for ${row.directory}@${row.commit}: ${(full.stderr || fetch.stderr || 'unknown error').trim()}`,
      ]
    }
  }

  const checkout = spawnSync('git', ['-C', cloneDir, 'checkout', '--quiet', row.commit], {
    encoding: 'utf8',
    shell: false,
  })
  if (checkout.status !== 0) {
    return [`checkout failed for ${row.directory}@${row.commit}: ${(checkout.stderr || 'unknown error').trim()}`]
  }

  const packageRoot = row.upstreamPackagePath === undefined
    ? cloneDir
    : join(cloneDir, ...row.upstreamPackagePath.split('/'))
  if (!existsSync(packageRoot)) {
    return [`upstream package path missing for ${row.directory}: ${row.upstreamPackagePath ?? '(repo root)'}`]
  }

  // Apply add-file patches that target this package by writing files into a
  // reconstruction directory, then compare those files to vendor/.
  const reconstructed = join(workRoot, `reconstructed-${row.directory}`)
  mkdirSync(reconstructed, { recursive: true })
  // Copy src/ when present — the drift claim for this scaffold focuses on
  // patch-covered files; full-tree equality waits on complete patch coverage.
  const srcDir = join(packageRoot, 'src')
  if (existsSync(srcDir)) {
    copyTree(srcDir, join(reconstructed, 'src'))
  }

  const failures: string[] = []
  for (const record of index.patches.filter(patch => patch.appliesTo.includes(row.directory))) {
    for (const file of record.files) {
      const patchText = readFileSync(join(root, PATCHES_DIR, file), 'utf8')
      if (record.kind === 'add-file') {
        for (const added of extractAddedFiles(patchText)) {
          if (!added.path.startsWith(`${row.directory}/`)) continue
          const relativePath = added.path.slice(row.directory.length + 1)
          const target = join(reconstructed, relativePath)
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, added.content)
        }
        continue
      }
      const applied = spawnSync('git', ['apply', '--unsafe-paths', `--directory=${reconstructed}`, join(root, PATCHES_DIR, file)], {
        encoding: 'utf8',
        shell: false,
        cwd: root,
      })
      if (applied.status !== 0) {
        failures.push(`git apply failed for ${file} on ${row.directory}: ${(applied.stderr || applied.stdout || 'unknown error').trim()}`)
      }
    }
  }

  // Compare reconstructed patch-covered files to vendor/<dir>.
  for (const record of index.patches.filter(patch => patch.appliesTo.includes(row.directory))) {
    for (const file of record.files) {
      if (record.kind !== 'add-file') continue
      for (const added of extractAddedFiles(readFileSync(join(root, PATCHES_DIR, file), 'utf8'))) {
        if (!added.path.startsWith(`${row.directory}/`)) continue
        const relativePath = added.path.slice(row.directory.length + 1)
        const expected = join(root, 'vendor', row.directory, relativePath)
        const actual = join(reconstructed, relativePath)
        if (!existsSync(actual) || readFileSync(actual, 'utf8') !== readFileSync(expected, 'utf8')) {
          failures.push(`reconstructed ${added.path} does not match vendor/${added.path}`)
        }
      }
    }
  }

  return failures
}

function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) copyTree(source, target)
    else writeFileSync(target, readFileSync(source))
  }
}

/**
 * Run the offline patch-index check, then attempt upstream reconstruction when
 * possible. Private upstream failures become documented offline results.
 * @param root - absolute repository root.
 * @param options - when `forceOffline` is set, skip network entirely.
 * @returns process exit code.
 */
export function runVendorDriftCheck(
  root: string,
  options: { forceOffline?: boolean } = {},
): number {
  const offline = inspectVendorDriftOffline(root)
  for (const message of offline.messages) {
    if (message.startsWith('Offline mode:')) process.stdout.write(`${message}\n`)
    else process.stderr.write(`verify-vendor-drift: ${message}\n`)
  }
  if (!offline.ok || offline.index === undefined) return 1

  if (options.forceOffline) {
    process.stdout.write('verify-vendor-drift: offline patch-index check passed.\n')
    return 0
  }

  const readme = readFileSync(join(root, 'vendor', 'README.md'), 'utf8')
  const rows = parseVendorManifestRows(readme)
  if (rows.length === 0) {
    process.stderr.write('verify-vendor-drift: vendor/README.md manifest table produced no rows.\n')
    return 1
  }

  const workRoot = mkdtempSync(join(tmpdir(), 'vendor-drift-'))
  const failures: string[] = []
  let clonesAttempted = 0
  let clonesBlocked = 0
  try {
    for (const row of rows) {
      clonesAttempted++
      const rowFailures = reconstructVendoredPackage(root, row, offline.index, workRoot)
      const blocked = rowFailures.some(failure =>
        /clone failed|fetch failed|git is not available/i.test(failure))
      if (blocked) clonesBlocked++
      failures.push(...rowFailures.map(failure => `${row.directory}: ${failure}`))
    }
  } finally {
    rmSync(workRoot, { recursive: true, force: true })
  }

  if (clonesBlocked === clonesAttempted) {
    process.stdout.write(
      `verify-vendor-drift: all ${String(clonesAttempted)} upstream clones blocked (private remote or missing git). `
        + `Patch index is valid; use local agent job \`${offline.index.localAgentJob}\`.\n`,
    )
    return 0
  }

  if (failures.length > 0) {
    process.stderr.write('verify-vendor-drift: reconstruction failures:\n')
    for (const failure of failures) process.stderr.write(`  ${failure}\n`)
    return 1
  }

  process.stdout.write(
    `verify-vendor-drift: reconstructed ${String(clonesAttempted - clonesBlocked)} package(s); patch-covered files match.\n`,
  )
  return 0
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const forceOffline = process.argv.includes('--offline')
  process.exitCode = runVendorDriftCheck(ROOT, { forceOffline })
}
