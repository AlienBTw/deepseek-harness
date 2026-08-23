/**
 * @module @maple/context-repo-map
 *
 * Proactive Tree-Sitter AST Repo-Map context provider for Maple Harness.
 * Injects a token-bounded, PageRank-ordered structural outline of the
 * workspace directly into the agent's context before tools are called.
 */

import type { Context } from '@maple/cordis'
import z from '@maple/schemastery'
import type { PreStepDecision } from '@maple/agent'
import { createUserMessage } from '@maple/llm'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { RepoMap } from './repomap'
import { getTags } from './parser'
import type { SourceFile } from './types'

export const name = 'repo-map'
export const inject = ['agents']

/**
 * The plugin's configuration schema.
 */
export interface Config {
  /** Maximum token budget for the repo-map outline. Default: 2000. */
  maxTokens?: number
  /** Maximum files scanned in the workspace. Default: 5000. */
  maxFiles?: number
  /** File extensions to include in scanning. */
  includeExtensions?: string[]
}

export const Config: z<Config> = z.object({
  maxTokens: z.number().default(2000),
  maxFiles: z.number().default(5000),
  includeExtensions: z.array(z.string()).default([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.rs', '.go', '.c', '.h', '.cpp', '.hpp',
    '.cc', '.cxx', '.hxx', '.cs', '.java', '.php',
    '.rb', '.kt', '.kts', '.swift', '.md', '.json',
  ]),
})

const DEFAULT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rs', '.go', '.c', '.h', '.cpp', '.hpp',
  '.cc', '.cxx', '.hxx', '.cs', '.java', '.php',
  '.rb', '.kt', '.kts', '.swift', '.md', '.json',
])

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out',
  '.next', '.turbo', 'target', 'vendor', '__pycache__',
])

/** Recursively scan workspace directory for relevant source files. */
async function scanWorkspace(
  dir: string,
  root: string,
  maxFiles: number,
  collected: SourceFile[] = [],
): Promise<SourceFile[]> {
  if (collected.length >= maxFiles) return collected

  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return collected
  }

  for (const entry of entries) {
    if (collected.length >= maxFiles) break
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        await scanWorkspace(fullPath, root, maxFiles, collected)
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (DEFAULT_EXTENSIONS.has(ext)) {
        try {
          const content = await fs.readFile(fullPath, 'utf8')
          const rel_fname = path.relative(root, fullPath).replace(/\\/g, '/')
          collected.push({ rel_fname, fname: fullPath, content })
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  return collected
}

export function apply(ctx: Context, config: Config): void {
  const maxTokens = config.maxTokens ?? 2000
  const maxFiles = config.maxFiles ?? 5000
  const repoMapEngine = new RepoMap({ getTags })

  ctx.on('agent/pre-step', async (
    { agent, step, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision

    // Only inject proactive repo-map on the first step of a turn
    if (step !== 1) return decision

    // Determine workspace root
    const workspaceRoot = agent.session.header.cwd || process.cwd()

    try {
      const sourceFiles = await scanWorkspace(workspaceRoot, workspaceRoot, maxFiles)
      if (sourceFiles.length === 0) return decision

      const result = await repoMapEngine.getRepoMap({
        sourceFiles,
        maxMapTokens: maxTokens,
      })

      const repoMapText = result.repoMap
      if (!repoMapText || repoMapText.trim().length === 0) return decision

      const formatted = '=== REPOSITORY MAP (AST Structure & Key Symbols) ===\n'
        + 'This map shows key classes, interfaces, function signatures, and method definitions '
        + 'ranked by importance. Use it to understand the codebase structure without needing blind searches.\n\n'
        + repoMapText

      return {
        kind: 'enter',
        messages: [
          ...decision.messages,
          createUserMessage({
            content: [{ type: 'text', text: formatted }],
            source: {
              kind: 'plugin',
              plugin: name,
              form: 'snapshot',
              sections: [{ name, text: formatted }],
            },
          }),
        ],
      }
    } catch (error: unknown) {
      ctx.logger.warn('repo-map generation failed: %o', error)
      return decision
    }
  }, { prepend: true })
}

/**
 * The cordis plugin face: name, injected services, schema, and the apply body
 * registering the first-step repo-map injection.
 */
export default { name, apply, Config }
