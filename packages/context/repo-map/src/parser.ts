/**
 * repomap/parser.ts — web-tree-sitter integration + tag extraction.
 */

import Parser from 'web-tree-sitter'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { langForFile, queryForLang, type SupportedLang } from './queries'
import type { Tag } from './types'

type Language = Parser.Language

const grammarCache = new Map<SupportedLang, Language>()

function hashContent(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c64e6d
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * Content-hash-tag cache for one file: a re-read with identical bytes
 * replays the stored tags and skips grammar extraction entirely.
 */
export class TagCache {
  private cache = new Map<string, { hash: string; tags: Tag[] }>()

  /**
   * The tags stored for this path, when its content is unchanged.
   * @param rel_fname - the cache key.
   * @param content - current file content, hashed against the stored entry.
   * @returns the cached tags, or `null` on miss or content change.
   */
  get(rel_fname: string, content: string): Tag[] | null {
    const entry = this.cache.get(rel_fname)
    if (!entry) return null
    if (entry.hash !== hashContent(content)) return null
    return entry.tags
  }

  /**
   * Store one file's tags under its content hash.
   * @param rel_fname - the cache key.
   * @param content - the exact content the tags were extracted from.
   * @param tags - the extracted tags.
   */
  set(rel_fname: string, content: string, tags: Tag[]): void {
    this.cache.set(rel_fname, { hash: hashContent(content), tags })
  }

  /** Drop every entry (grammar reloads, tests). */
  clear(): void {
    this.cache.clear()
  }
}

/** Process-wide tag cache shared by every {@link getTags} call. */
export const globalTagCache = new TagCache()

let wasmInitPromise: Promise<void> | null = null

function ensureParserInit(): Promise<void> {
  if (!wasmInitPromise) {
    const require = createRequire(import.meta.url)
    const wasmPath = require.resolve('web-tree-sitter/tree-sitter.wasm')
    wasmInitPromise = Parser.init({
      locateFile: (scriptName: string) => {
        if (scriptName === 'tree-sitter.wasm') return wasmPath
        return scriptName
      },
    })
  }
  return wasmInitPromise
}

/**
 * Load (and memoize) the Tree-Sitter grammar WASM for one language.
 * @param lang - a language key this build ships a grammar for.
 * @returns the loaded pi-ai language handle.
 */
export async function loadGrammar(lang: SupportedLang): Promise<Language> {
  const cached = grammarCache.get(lang)
  if (cached) return cached

  await ensureParserInit()
  const require = createRequire(import.meta.url)
  const wasmPkgPath = require.resolve(`tree-sitter-wasms/out/tree-sitter-${lang}.wasm`)
  const wasmBuffer = await fs.readFile(wasmPkgPath)
  const language = await Parser.Language.load(wasmBuffer)
  grammarCache.set(lang, language)
  return language
}

/**
 * Extract def/ref symbol tags from one file, memoized by content hash.
 * @param rel_fname - path relative to the repository root; picks the grammar.
 * @param fname - absolute or resolvable path used to read content when absent.
 * @param content - file source; read from disk when omitted.
 * @returns the extracted tags, empty for unsupported languages and unreadable files.
 */
export async function getTags(
  rel_fname: string,
  fname?: string,
  content?: string,
): Promise<Tag[]> {
  const effectiveFname = fname ?? rel_fname
  let source = content
  if (source === undefined) {
    try {
      source = await fs.readFile(effectiveFname, 'utf8')
    } catch {
      return []
    }
  }

  const cached = globalTagCache.get(rel_fname, source)
  if (cached) return cached

  const lang = langForFile(rel_fname)
  if (!lang) return []

  const scmQuery = queryForLang(lang)
  if (!scmQuery) return []

  let language: Language
  try {
    language = await loadGrammar(lang)
  } catch {
    return []
  }

  const parser = new Parser()
  parser.setLanguage(language)
  const tree = parser.parse(source)
  const query = language.query(scmQuery)
  const captures = query.captures(tree.rootNode)

  const tags: Tag[] = []
  for (const capture of captures) {
    const node = capture.node
    const captureName = capture.name
    const isDef = captureName.startsWith('name.definition.')
    const isRef = captureName.startsWith('name.reference.')

    if (!isDef && !isRef) continue

    const name = node.text
    if (!name || name.length === 0) continue

    tags.push({
      rel_fname,
      fname: effectiveFname,
      line: node.startPosition.row,
      name,
      kind: isDef ? 'def' : 'ref',
    })
  }

  tree.delete()
  globalTagCache.set(rel_fname, source, tags)
  return tags
}
