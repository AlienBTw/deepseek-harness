#!/usr/bin/env node
/**
 * Stage the release sidecar layout under src-tauri/sidecar/:
 *
 *   sidecar/cli/bin.js   — built dsh CLI entry (from apps/cli/lib/bin.js)
 *   sidecar/node/node[.exe] — Node runtime copied from NODE_SIDECAR or `node` on PATH
 *
 * Run after `pnpm run build` at the repo root. `pnpm desktop:build` invokes this
 * automatically through package.json.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(here, '..')
const repoRoot = resolve(desktopRoot, '../..')
const sidecarRoot = join(desktopRoot, 'src-tauri', 'sidecar')
const cliOut = join(sidecarRoot, 'cli', 'bin.js')
const cliSrc = join(repoRoot, 'apps', 'cli', 'lib', 'bin.js')

if (!existsSync(cliSrc)) {
  console.error(`[prepare-sidecar] missing ${cliSrc}; run pnpm run build at the repo root first`)
  process.exit(1)
}

mkdirSync(dirname(cliOut), { recursive: true })
copyFileSync(cliSrc, cliOut)

const nodeSrc = process.env.NODE_SIDECAR
  ?? (process.platform === 'win32'
    ? execFileSync('where', ['node'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
    : execFileSync('which', ['node'], { encoding: 'utf8' }).trim())

if (!nodeSrc || !existsSync(nodeSrc)) {
  console.error('[prepare-sidecar] could not locate a Node binary; set NODE_SIDECAR to an absolute path')
  process.exit(1)
}

const nodeOut = join(sidecarRoot, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
mkdirSync(dirname(nodeOut), { recursive: true })
copyFileSync(nodeSrc, nodeOut)
if (process.platform !== 'win32') {
  chmodSync(nodeOut, statSync(nodeOut).mode | 0o755)
}

console.log(`[prepare-sidecar] staged ${cliOut}`)
console.log(`[prepare-sidecar] staged ${nodeOut} (from ${nodeSrc})`)
