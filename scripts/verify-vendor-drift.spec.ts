import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  extractAddedFiles,
  inspectVendorDriftOffline,
} from './verify-vendor-drift.ts'

const root = resolve(import.meta.dirname, '..')
const roots: string[] = []

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('vendor drift scaffold', () => {
  it('extracts add-file payloads from unified diffs', () => {
    const files = extractAddedFiles([
      'diff --git a/schemastery/tsdown.config.ts b/schemastery/tsdown.config.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/schemastery/tsdown.config.ts',
      '@@ -0,0 +1,2 @@',
      '+line-one',
      '+line-two',
      '',
    ].join('\n'))
    expect(files).toEqual([{ path: 'schemastery/tsdown.config.ts', content: 'line-one\nline-two\n' }])
  })

  it('accepts the checked-in patch index offline', () => {
    const report = inspectVendorDriftOffline(root)
    expect(report.ok).toBe(true)
    expect(report.index?.localAgentJob).toBe('pnpm run verify-vendor-drift')
    expect(report.messages.some(message => message.startsWith('Offline mode:'))).toBe(true)
  })

  it('rejects an unindexed patch file', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'vendor-drift-'))
    roots.push(fixture)
    mkdirSync(join(fixture, 'vendor/patches'), { recursive: true })
    writeFileSync(join(fixture, 'vendor/patches/index.json'), JSON.stringify({
      patches: [],
      unpatchedLogEntries: {},
      localAgentJob: 'pnpm run verify-vendor-drift',
    }))
    writeFileSync(join(fixture, 'vendor/patches/orphan.patch'), 'diff --git a/x b/x\n')
    const report = inspectVendorDriftOffline(fixture)
    expect(report.ok).toBe(false)
    expect(report.messages).toContain('vendor/patches/orphan.patch is not listed in index.json')
  })

  it('keeps add-file patches aligned with vendor files', () => {
    const schemastery = extractAddedFiles(
      readFileSync(join(root, 'vendor/patches/05-schemastery-tsdown.config.ts.patch'), 'utf8'),
    )
    expect(schemastery).toHaveLength(1)
    expect(schemastery[0]?.content).toBe(
      readFileSync(join(root, 'vendor/schemastery/tsdown.config.ts'), 'utf8'),
    )
  })
})
