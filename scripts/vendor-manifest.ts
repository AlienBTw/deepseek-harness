/**
 * Parse the vendored-package manifest table out of `vendor/README.md`.
 * Shared by license inventory and vendor-drift checks.
 * @module scripts/vendor-manifest
 */

/** One vendored package row from the `vendor/README.md` manifest table. */
export interface VendorManifestRow {
  /** Directory name under `vendor/` (no trailing slash). */
  directory: string
  /** Scoped npm package name published from this tree. */
  npmName: string
  /** Upstream package name before `@maple` rescope. */
  upstreamName: string
  /** Upstream version string from the table. */
  version: string
  /** Upstream repository HTTPS URL without trailing package-path note. */
  upstreamRepo: string
  /** Optional monorepo package path inside the upstream repo (e.g. `packages/core`). */
  upstreamPackagePath: string | undefined
  /** Pinned upstream commit SHA. */
  commit: string
}

/**
 * Parse every data row of the vendored manifest table.
 * @param text - complete `vendor/README.md` contents.
 * @returns rows in table order; empty when the column layout no longer matches.
 */
export function parseVendorManifestRows(text: string): VendorManifestRow[] {
  const rows: VendorManifestRow[] = []
  for (const line of text.split('\n')) {
    // Directory | npm name | Upstream name | Version | Upstream repo [(path)] | Commit
    // Optional path is written as (`packages/core`) after the URL.
    const match = /^\| `(\S+)\/` \| `([^`]+)` \| `([^`]+)` \| (\S+) \| (https:\/\/\S+?)(?: \(`([^`]+)`\))? \| `([0-9a-f]+)` \|$/.exec(line)
    if (match === null) continue
    const [, directory, npmName, upstreamName, version, upstreamRepo, upstreamPackagePath, commit] = match
    if (
      directory === undefined
      || npmName === undefined
      || upstreamName === undefined
      || version === undefined
      || upstreamRepo === undefined
      || commit === undefined
    ) {
      continue
    }
    rows.push({
      directory,
      npmName,
      upstreamName,
      version,
      upstreamRepo,
      upstreamPackagePath,
      commit,
    })
  }
  return rows
}

/** One license-inventory row from the dedicated table in `vendor/README.md`. */
export interface VendorLicenseInventoryRow {
  /** Directory name under `vendor/` (no trailing slash). */
  directory: string
  /** SPDX license identifier expected in that package's `package.json`. */
  license: string
}

/**
 * Parse the license inventory table that follows a `## License inventory` heading.
 * @param text - complete `vendor/README.md` contents.
 * @returns inventory rows in table order.
 */
export function parseVendorLicenseInventory(text: string): VendorLicenseInventoryRow[] {
  const lines = text.split('\n')
  const heading = lines.findIndex(line => line === '## License inventory')
  if (heading < 0) return []

  const rows: VendorLicenseInventoryRow[] = []
  for (let index = heading + 1; index < lines.length; index++) {
    const line = lines[index]
    if (line === undefined) break
    if (line.startsWith('## ')) break
    const match = /^\| `(\S+)\/` \| `([^`]+)` \|$/.exec(line)
    if (match === null) continue
    const [, directory, license] = match
    if (directory === undefined || license === undefined) continue
    rows.push({ directory, license })
  }
  return rows
}
