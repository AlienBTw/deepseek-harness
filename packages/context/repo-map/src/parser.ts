/**
 * repomap/parser.ts — web-tree-sitter integration + tag extraction.
 *
 * Uses `web-tree-sitter@0.22.x` (the last release whose Emscripten runtime
 * accepts the `dylink` section format used by `tree-sitter-wasms@0.1.x`).
 * web-tree-sitter 0.23+ switched to `dylink.0` and is incompatible with these
 * prebuilt WASMs without binary patching. Pinning 0.22.6 is the cleanest fix.
 *
 * GOTCHA (per the blueprint): In a VS Code extension, WASM path resolution is
 * hard. The likely fix is to bundle the `.wasm` files into the extension output
 * dir and load them via `vscode-file:` URIs. This module isolates all
 * environment-specific grammar loading behind `loadGrammar` /
 * `createParserFactory`, so the rest of the engine stays portable.
 */

import Parser from 'web-tree-sitter'
import { promises as fs } from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { langForFile, queryForLang, type SupportedLang } from './queries'
import type { Tag } from './types'

type Language = Parser.Language

/** Lazily-loaded grammars, keyed by language name. */
const grammarCache = new Map<SupportedLang, Language>()

/** Fast string hash for content cache keys. */
function hashContent(str: string): string {
  let h1 = 0xdeadbeef,
    h2 = 0x41c64e6d
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** In-memory tag cache for fast incremental repo-map generation. */
export class TagCache {
  private cache = new Map<string, { hash: string; tags: Tag[] }>()

  get(rel_fname: string, content: string): Tag[] | null {
    const entry = this.cache.get(rel_fname)
    if (!entry) return null
    const currentHash = hashContent(content)
    if (entry.hash === currentHash) {
      return entry.tags
    }
    return null
  }

  set(rel_fname: string, content: string, tags: Tag[]): void {
    const hash = hashContent(content)
    this.cache.set(rel_fname, { hash, tags })
  }

  clear(): void {
    this.cache.clear()
  }
}

export const tagCache = new TagCache()

/** Resolve the WASM path for a language from the `tree-sitter-wasms` package. */
function wasmPathForLang(lang: SupportedLang): string {
  const wasmsPkgDir = requireResolve('tree-sitter-wasms/out')
  const fileMap: Record<SupportedLang, string> = {
    typescript: 'tree-sitter-typescript.wasm',
    tsx: 'tree-sitter-tsx.wasm',
    javascript: 'tree-sitter-javascript.wasm',
    python: 'tree-sitter-python.wasm',
    rust: 'tree-sitter-rust.wasm',
    go: 'tree-sitter-go.wasm',
    c: 'tree-sitter-c.wasm',
    cpp: 'tree-sitter-cpp.wasm',
    c_sharp: 'tree-sitter-c_sharp.wasm',
    java: 'tree-sitter-java.wasm',
    php: 'tree-sitter-php.wasm',
    ruby: 'tree-sitter-ruby.wasm',
    kotlin: 'tree-sitter-kotlin.wasm',
    swift: 'tree-sitter-swift.wasm',
  }
  return path.join(wasmsPkgDir, fileMap[lang])
}

/**
 * Resolve a package subpath to an absolute file path.
 *
 * Tries `createRequire(import.meta.url)` first (ESM/Next.js server), then
 * falls back to `createRequire(<cwd>/package.json)` (bundled contexts). For the
 * VS Code extension port, replace this with a vscode-file: URI loader.
 */
function requireResolve(spec: string): string {
  const candidates: Array<() => NodeRequire> = []
  try {
    const url = (import.meta as { url?: string } | undefined)?.url
    if (url) candidates.push(() => createRequire(url))
  } catch {
    /* ignore */
  }
  candidates.push(() => createRequire(path.join(process.cwd(), 'package.json')))

  let lastErr: unknown = null
  for (const make of candidates) {
    try {
      const req = make()
      const pkgName = spec.split('/')[0]
      const pkgJsonPath = req.resolve(`${pkgName}/package.json`)
      const dir = path.dirname(pkgJsonPath)
      if (spec.includes('/')) {
        return path.join(dir, ...spec.split('/').slice(1))
      }
      return dir
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error(`Could not resolve "${spec}": ${String(lastErr)}`)
}

let initPromise: Promise<void> | null = null

/** Initialize the web-tree-sitter WASM runtime exactly once. */
export async function ensureParserInit(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const coreWasm = requireResolve('web-tree-sitter/tree-sitter.wasm')
        await Parser.init({ locateFile: () => coreWasm })
      } catch {
        // Fallback: let the runtime self-locate (works in many Node setups).
        await Parser.init()
      }
    })()
  }
  return initPromise
}

/** Load (and cache) a grammar for the given language. */
export async function loadGrammar(lang: SupportedLang): Promise<Language> {
  await ensureParserInit()
  const cached = grammarCache.get(lang)
  if (cached) return cached

  const wasmPath = wasmPathForLang(lang)
  const wasmBytes = await fs.readFile(wasmPath)
  // Language.load accepts a path or a Uint8Array. We pass bytes for portability
  // (the VS Code adapter will do the same, except bytes come from a vscode-file:
  // URI read instead of fs.readFile).
  const language = await Parser.Language.load(wasmBytes)

  grammarCache.set(lang, language)
  return language
}

/** Internal: extract tags from a parsed tree using a query. */
function extractTags(
  rel_fname: string,
  fname: string,
  captures: Array<{ name: string; node: Parser.SyntaxNode }>,
): Tag[] {
  const tags: Tag[] = []
  for (const cap of captures) {
    const capName = cap.name
    let kind: 'def' | 'ref' | null = null
    // Aider contract (repomap.py lines 317–324): only captures whose name
    // starts with `name.definition.` or `name.reference.` yield tags.
    if (capName.startsWith('name.definition.')) kind = 'def'
    else if (capName.startsWith('name.reference.')) kind = 'ref'
    else continue

    const node = cap.node
    tags.push({
      rel_fname,
      fname,
      line: node.startPosition.row, // 0-based, matching Aider's start_point[0]
      name: node.text,
      kind,
    })
  }
  return tags
}

/**
 * Extract symbol tags (defs + refs) from a source file using tree-sitter.
 *
 * Mirrors Aider's `get_tags` (repomap.py lines ~280–363):
 *   - Check the incremental TagCache first.
 *   - Parse the source if cache misses.
 *   - Run the language's tags query.
 *   - `@name.definition.*` captures -> def tags.
 *   - `@name.reference.*` captures -> ref tags.
 */
export async function getTags(rel_fname: string, fname: string, content: string): Promise<Tag[]> {
  const cached = tagCache.get(rel_fname, content)
  if (cached) return cached

  const lang = langForFile(rel_fname)
  if (!lang) return []

  const language = await loadGrammar(lang)
  const parser = new Parser()
  parser.setLanguage(language)

  const tree = parser.parse(content)
  if (!tree) return []

  // web-tree-sitter 0.22: query is an instance method on Language.
  const query = language.query(queryForLang(lang))
  const captures = query.captures(tree.rootNode)
  const tags = extractTags(rel_fname, fname, captures)

  tree.delete()
  query.delete()

  tagCache.set(rel_fname, content, tags)
  return tags
}

/**
 * Injectable tag extractor for environments where fs/require isn't available
 * (e.g. VS Code extension host). Pass a grammar loader; get back a getTags fn.
 */
export function createParserFactory(
  grammarLoader: (lang: SupportedLang) => Promise<Language>,
): (rel_fname: string, fname: string, content: string) => Promise<Tag[]> {
  return async (rel_fname, fname, content) => {
    const lang = langForFile(rel_fname)
    if (!lang) return []
    const language = await grammarLoader(lang)
    const parser = new Parser()
    parser.setLanguage(language)
    const tree = parser.parse(content)
    if (!tree) return []
    const query = language.query(queryForLang(lang))
    const captures = query.captures(tree.rootNode)
    const tags = extractTags(rel_fname, fname, captures)
    tree.delete()
    query.delete()
    return tags
  }
}
