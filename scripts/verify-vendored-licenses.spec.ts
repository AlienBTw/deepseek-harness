import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectVendoredLicenses } from './verify-vendored-licenses.ts'
import { parseVendorLicenseInventory, parseVendorManifestRows } from './vendor-manifest.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'vendored-licenses-'))
  roots.push(root)
  return root
}

const MANIFEST_HEADER = `| Directory | npm name | Upstream name | Version | Upstream repo | Commit |
|---|---|---|---|---|---|`

function writeVendorTree(
  root: string,
  packages: Array<{ directory: string; npmName: string; license: string; withLicenseFile?: boolean }>,
  inventoryLicenses?: Record<string, string>,
): void {
  mkdirSync(join(root, 'vendor'), { recursive: true })
  const rows = packages.map(pkg => (
    `| \`${pkg.directory}/\` | \`${pkg.npmName}\` | \`${pkg.directory}\` | 1.0.0 | https://example.com/upstream | \`abc123\` |`
  ))
  const inventory = packages.map((pkg) => {
    const license = inventoryLicenses?.[pkg.directory] ?? pkg.license
    return `| \`${pkg.directory}/\` | \`${license}\` |`
  })
  writeFileSync(join(root, 'vendor', 'README.md'), [
    '# Vendored',
    '',
    '## Manifest',
    '',
    MANIFEST_HEADER,
    ...rows,
    '',
    '## License inventory',
    '',
    '| Directory | SPDX license |',
    '|---|---|',
    ...inventory,
    '',
  ].join('\n'))

  for (const pkg of packages) {
    const dir = join(root, 'vendor', pkg.directory)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: pkg.npmName, license: pkg.license }, null, 2)}\n`)
    if (pkg.withLicenseFile !== false) {
      writeFileSync(join(dir, 'LICENSE'), 'MIT License\n')
    }
  }
}

describe('vendor-manifest parsers', () => {
  it('reads directory, commit, and optional upstream package path', () => {
    const rows = parseVendorManifestRows(
      '| `schemastery/` | `@maple/schemastery` | `schemastery` | 3.18.0 | https://github.com/example/schemastery (`packages/core`) | `e67cee00ad725bd1534aee930a979ea3eec6f698` |\n',
    )
    expect(rows).toEqual([{
      directory: 'schemastery',
      npmName: '@maple/schemastery',
      upstreamName: 'schemastery',
      version: '3.18.0',
      upstreamRepo: 'https://github.com/example/schemastery',
      upstreamPackagePath: 'packages/core',
      commit: 'e67cee00ad725bd1534aee930a979ea3eec6f698',
    }])
  })

  it('reads the license inventory table under its heading', () => {
    expect(parseVendorLicenseInventory([
      '## License inventory',
      '',
      '| Directory | SPDX license |',
      '|---|---|',
      '| `cordis/` | `MIT` |',
      '',
      '## Sync procedure',
    ].join('\n'))).toEqual([{ directory: 'cordis', license: 'MIT' }])
  })
})

describe('vendored license inventory gate', () => {
  it('accepts packages that carry LICENSE and match the inventory', () => {
    const root = fixtureRoot()
    writeVendorTree(root, [
      { directory: 'cordis', npmName: '@maple/cordis', license: 'MIT' },
      { directory: 'cosmokit', npmName: '@maple/cosmokit', license: 'MIT' },
    ])
    expect(inspectVendoredLicenses(root)).toEqual({ packageCount: 2, failures: [] })
  })

  it('rejects a missing LICENSE file', () => {
    const root = fixtureRoot()
    writeVendorTree(root, [
      { directory: 'cordis', npmName: '@maple/cordis', license: 'MIT', withLicenseFile: false },
    ])
    expect(inspectVendoredLicenses(root).failures).toContain('vendor/cordis/LICENSE is missing.')
  })

  it('rejects a package.json license that contradicts the inventory', () => {
    const root = fixtureRoot()
    writeVendorTree(
      root,
      [{ directory: 'cordis', npmName: '@maple/cordis', license: 'Apache-2.0' }],
      { cordis: 'MIT' },
    )
    expect(inspectVendoredLicenses(root).failures).toContain(
      'vendor/cordis/package.json license "Apache-2.0" does not match inventory "MIT".',
    )
  })
})
