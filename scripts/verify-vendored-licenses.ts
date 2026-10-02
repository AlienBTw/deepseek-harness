/**
 * Assert every vendored package carries its upstream LICENSE and that
 * package.json `license` matches the inventory table in vendor/README.md.
 * @module scripts/verify-vendored-licenses
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  parseVendorLicenseInventory,
  parseVendorManifestRows,
} from './vendor-manifest.ts'

const ROOT = resolve(import.meta.dirname, '..')

/** Report from checking vendored LICENSE files against the README inventory. */
export interface VendoredLicenseReport {
  /** Number of inventory rows checked. */
  packageCount: number
  /** Repository-relative diagnostics. */
  failures: string[]
}

function readManifest(root: string, directory: string): { name?: string; license?: unknown } {
  const file = join(root, 'vendor', directory, 'package.json')
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`verify-vendored-licenses: vendor/${directory}/package.json must contain a JSON object.`)
  }
  return parsed as { name?: string; license?: unknown }
}

function printable(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

/**
 * Check every vendored package against the license inventory in vendor/README.md.
 * @param root - absolute repository root.
 * @returns checked count and every mismatch or missing LICENSE.
 */
export function inspectVendoredLicenses(root: string): VendoredLicenseReport {
  const readme = readFileSync(join(root, 'vendor', 'README.md'), 'utf8')
  const manifestRows = parseVendorManifestRows(readme)
  const inventory = parseVendorLicenseInventory(readme)
  const failures: string[] = []

  if (manifestRows.length === 0) {
    failures.push('vendor/README.md manifest table produced no rows; column layout may have changed.')
  }
  if (inventory.length === 0) {
    failures.push('vendor/README.md has no ## License inventory table rows.')
  }

  const inventoryByDir = new Map(inventory.map(row => [row.directory, row.license]))
  const manifestDirs = new Set(manifestRows.map(row => row.directory))

  for (const row of inventory) {
    if (!manifestDirs.has(row.directory)) {
      failures.push(`license inventory lists vendor/${row.directory}/ but the manifest table has no such row.`)
    }
  }

  for (const row of manifestRows) {
    const expected = inventoryByDir.get(row.directory)
    if (expected === undefined) {
      failures.push(`vendor/${row.directory}/ is in the manifest table but missing from ## License inventory.`)
      continue
    }

    const licensePath = join(root, 'vendor', row.directory, 'LICENSE')
    if (!existsSync(licensePath)) {
      failures.push(`vendor/${row.directory}/LICENSE is missing.`)
    }

    const manifest = readManifest(root, row.directory)
    if (manifest.license !== expected) {
      failures.push(
        `vendor/${row.directory}/package.json license ${printable(manifest.license)} does not match inventory ${JSON.stringify(expected)}.`,
      )
    }
    if (typeof manifest.name === 'string' && manifest.name !== row.npmName) {
      failures.push(
        `vendor/${row.directory}/package.json name ${JSON.stringify(manifest.name)} does not match manifest table ${JSON.stringify(row.npmName)}.`,
      )
    }
  }

  // Directories with package.json under vendor/ must appear in both tables.
  for (const entry of readdirSync(join(root, 'vendor'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!existsSync(join(root, 'vendor', entry.name, 'package.json'))) continue
    if (!manifestDirs.has(entry.name)) {
      failures.push(`vendor/${entry.name}/ has package.json but is absent from the manifest table.`)
    }
  }

  return { packageCount: inventory.length, failures }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const report = inspectVendoredLicenses(ROOT)
  if (report.failures.length > 0) {
    process.stderr.write('verify-vendored-licenses: vendored license inventory failures:\n')
    for (const failure of report.failures) process.stderr.write(`  ${failure}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(
      `verify-vendored-licenses: ${String(report.packageCount)} vendored package(s) carry LICENSE and match the inventory.\n`,
    )
  }
}
