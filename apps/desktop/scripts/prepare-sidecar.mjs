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

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(here, '..')
const repoRoot = resolve(desktopRoot, '../..')
const sidecarRoot = join(desktopRoot, 'src-tauri', 'sidecar')
const cliOut = join(sidecarRoot, 'cli', 'bin.js')
const cliSrc = join(repoRoot, 'apps', 'cli', 'lib', 'bin.js')
const splashOut = join(desktopRoot, 'dist', 'index.html')

/** Static splash shown until the web host prints its readiness URL. */
const SPLASH_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Maple</title>
    <style>
      html, body { height: 100%; margin: 0; }
      body {
        display: grid;
        place-items: center;
        background: #14161a;
        color: #9aa3af;
        font: 15px/1.6 system-ui, sans-serif;
      }
      .mark { font-size: 34px; font-weight: 650; color: #e8eaed; letter-spacing: 0.02em; }
      .status { margin-top: 10px; }
      @media (prefers-reduced-motion: no-preference) {
        .status::after { content: '…'; animation: dots 1.2s steps(4) infinite; }
        @keyframes dots { 0% { content: ''; } 75% { content: '…'; } }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="mark">Maple</div>
      <div class="status">Starting the local harness</div>
    </main>
  </body>
</html>
`

if (!existsSync(cliSrc)) {
  console.error(`[prepare-sidecar] missing ${cliSrc}; run pnpm run build at the repo root first`)
  process.exit(1)
}

mkdirSync(dirname(cliOut), { recursive: true })
copyFileSync(cliSrc, cliOut)

mkdirSync(dirname(splashOut), { recursive: true })
writeFileSync(splashOut, SPLASH_HTML)
console.log(`[prepare-sidecar] wrote ${splashOut}`)

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
