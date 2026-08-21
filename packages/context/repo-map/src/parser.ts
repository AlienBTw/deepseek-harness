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

export class TagCache {
  private cache = new Map<string, { hash: string; tags: Tag[] }>()

  get(rel_fname: string, content: string): Tag[] | null {
    const entry = this.cache.get(rel_fname)
    if (!entry) return null
    if (entry.hash !== hashContent(content)) return null
    return entry.tags
  }

  set(rel_fname: string, content: string, tags: Tag[]): void {
    this.cache.set(rel_fname, { hash: hashContent(content), tags })
  }

  clear(): void {
    this.cache.clear()
  }
}

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

export async function getTags(
  rel_fname: string,
  fname?: string,
  content?: string
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
