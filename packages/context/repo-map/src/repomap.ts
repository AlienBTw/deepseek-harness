/**
 * repomap/repomap.ts — The RepoMap engine: tags → graph → PageRank → ranked tags
 * → token-budgeted map.
 *
 * Faithful port of Aider's `RepoMap.get_ranked_tags` + `get_ranked_tags_map` +
 * `to_tree` (repomap.py lines 365–784).
 *
 * PORTABILITY: The only environment-specific piece is grammar loading (parser.ts).
 * Everything else — tags, graph, PageRank, TreeContext, tokenizer — is pure
 * TypeScript with zero Node/VS Code deps. To use in a VS Code extension, copy
 * this `src/lib/repomap/` folder in and swap the grammar loader for one that
 * reads `vscode-file:` URIs (see `createParserFactory` in parser.ts).
 */

import Parser from 'web-tree-sitter'
import { getTags, loadGrammar } from './parser'
import { langForFile } from './queries'
import {
  buildGraph,
  runPageRank,
  buildRankedTags,
  rankedDefinitionsToArray,
} from './graph'
import {
  renderTreeContext,
  collectScopeNodes,
  type ParsedFile,
  type TSNode,
} from './tree-context'
import { tokenCount } from './tokenizer'
import type {
  RepoMapOptions,
  RepoMapResult,
  SourceFile,
  Tag,
  RankedTag,
} from './types'

const DEFAULT_MAX_MAP_TOKENS = 2000

const IMPORTANT_FILENAMES = new Set([
  'readme', 'readme.md', 'readme.txt', 'readme.rst',
  'makefile', 'package.json', 'package-lock.json', 'cargo.toml',
  'go.mod', 'pyproject.toml', 'setup.py', 'requirements.txt',
])

function isImportant(rel_fname: string): boolean {
  const base = (rel_fname.split('/').pop() ?? '').toLowerCase()
  return IMPORTANT_FILENAMES.has(base)
}

/** The RepoMap engine. */
export type TagExtractor = (rel_fname: string, fname?: string, content?: string) => Promise<Tag[]>

/**
 * The RepoMap engine: tags → graph → PageRank → ranked tags → token-budgeted
 * map. Construct once per consumer; every call re-reads the files it is given.
 */
export class RepoMap {
  private customGetTags?: TagExtractor

  /**
   * @param options - an alternate tag extractor; omission uses the shared
   *   grammar-backed {@link getTags}.
   */
  constructor(options?: { getTags?: TagExtractor }) {
    if (options?.getTags) {
      this.customGetTags = options.getTags
    }
  }
  /**
   * Compute the full repo-map for a set of source files.
   *
   * @param filesOrOptions - source files to map, or the options object carrying
   *   them under `sourceFiles`.
   * @param options - budget / chat / mentioned config
   * @returns         rendered map + all intermediate data for visualization
   */
  async getRepoMap(
    filesOrOptions: SourceFile[] | (RepoMapOptions & { sourceFiles: SourceFile[] }),
    options: RepoMapOptions = {},
  ): Promise<RepoMapResult> {
    const t0 = Date.now()
    let files: SourceFile[]
    let opts: RepoMapOptions
    if (Array.isArray(filesOrOptions)) {
      files = filesOrOptions
      opts = options
    } else {
      files = filesOrOptions.sourceFiles
      opts = filesOrOptions
    }
    const {
      maxMapTokens = DEFAULT_MAX_MAP_TOKENS,
      chatFnames = [],
      otherFnames = [],
      mentionedIdents = [],
      mentionedFnames = [],
      pagerankAlpha = 0.85,
      pagerankMaxIter = 1000,
      pagerankTol = 1e-6,
    } = opts
    const tagExtractor = this.customGetTags || getTags

    // 1. Extract tags from every file (async — needs grammar).
    const allTags: Tag[] = []
    for (const file of files) {
      const tags = await tagExtractor(file.rel_fname, file.fname, file.content)
      allTags.push(...tags)
    }

    // 2. Pre-parse every file ONCE into ParsedFile (reused across binary search).
    const parsedFiles = await this.preParseFiles(files)

    const chatRelFnames = new Set(chatFnames)
    const mentionedRelFnames = new Set(mentionedFnames)
    const mentionedIdentsSet = new Set(mentionedIdents)
    const allRelFnames = new Set(files.map(f => f.rel_fname))
    void otherFnames

    // 3. Build the reference graph + personalization.
    const built = buildGraph({
      tags: allTags,
      chatRelFnames,
      mentionedRelFnames,
      mentionedIdents: mentionedIdentsSet,
    })

    // 4. Run personalized PageRank + distribute rank.
    const { pagerank, rankedDefinitions } = runPageRank({
      graph: built.graph,
      personalization: built.personalization,
      fileCount: built.fileCount,
      alpha: pagerankAlpha,
      maxIter: pagerankMaxIter,
      tol: pagerankTol,
    })

    // 5. Build the ranked tag list (defs sorted by rank + tag-less file sentinels).
    let rankedTags = buildRankedTags(
      rankedDefinitions,
      built.definitions,
      pagerank.ranks,
      chatRelFnames,
      allRelFnames,
    )

    // 5a. Prepend important files (1-tuple sentinels) — repomap.py lines 656–662.
    const rankedTagsFnames = new Set(
      rankedTags.map(rt => (rt.type === 'tag' ? rt.tag.rel_fname : rt.fname)),
    )
    const specialFnames = files
      .map(f => f.rel_fname)
      .filter(f => isImportant(f) && !rankedTagsFnames.has(f))
      .sort()
    rankedTags = [
      ...specialFnames.map((fname): RankedTag => ({ type: 'file', fname })),
      ...rankedTags,
    ]

    // 6. Binary-search the token budget (repomap.py lines 666–706).
    const { tree: bestTree, tokens: bestTokens } = this.binarySearchBudget(
      rankedTags,
      parsedFiles,
      chatRelFnames,
      maxMapTokens,
    )

    // 7. Build serialized graph for the API response.
    const graphEdges: Array<{ src: string; dst: string; ident: string; weight: number }> = []
    for (const [src, inner] of built.graph.edges) {
      for (const [dst, identMap] of inner) {
        for (const [ident, weight] of identMap) {
          graphEdges.push({ src, dst, ident, weight })
        }
      }
    }

    const nodeRanks = [...pagerank.ranks.entries()]
      .map(([fname, rank]) => ({ fname, rank }))
      .sort((a, b) => b.rank - a.rank)

    return {
      repoMap: bestTree,
      tags: allTags,
      graph: {
        nodes: [...built.graph.nodes].sort(),
        edges: graphEdges.sort((a, b) => b.weight - a.weight),
      },
      nodeRanks,
      rankedDefinitions: rankedDefinitionsToArray(rankedDefinitions),
      rankedTags,
      tokenCount: bestTokens,
      stats: {
        fileCount: files.length,
        tagCount: allTags.length,
        defCount: allTags.filter(t => t.kind === 'def').length,
        refCount: allTags.filter(t => t.kind === 'ref').length,
        edgeCount: graphEdges.length,
        pagerankIterations: pagerank.iterations,
        pagerankConverged: pagerank.converged,
        renderTimeMs: Date.now() - t0,
      },
    }
  }

  /** Parse every file once, extracting plain-JS scope data for the renderer. */
  private async preParseFiles(files: SourceFile[]): Promise<Map<string, ParsedFile>> {
    const out = new Map<string, ParsedFile>()
    for (const file of files) {
      const lang = langForFile(file.rel_fname)
      let scopeSpans: Array<{ startRow: number; endRow: number }> = []
      let ancestorHeadersByStartRow = new Map<number, number[]>()
      if (lang) {
        try {
          const language = await loadGrammar(lang)
          const parser = new Parser()
          parser.setLanguage(language)
          const tree = parser.parse(file.content)
          const rootNode = tree.rootNode as unknown as TSNode
          // Extract all needed AST data as plain JS, THEN free the WASM tree.
          // The renderer never touches WASM node objects after this.
          const collected = collectScopeNodes(rootNode)
          scopeSpans = collected.scopeSpans
          ancestorHeadersByStartRow = collected.ancestorHeadersByStartRow
          tree.delete()
        } catch {
          // Parsing failed; renderer will fall back to bare LOI lines.
        }
      }
      out.set(file.rel_fname, {
        rel_fname: file.rel_fname,
        source: file.content,
        lines: file.content.split(/\r?\n/),
        scopeSpans,
        ancestorHeadersByStartRow,
      })
    }
    return out
  }

  /**
   * Binary search over the number of ranked tags to find the largest prefix
   * whose rendered tree fits the token budget (within 15% tolerance).
   * Mirrors repomap.py lines 666–706.
   */
  private binarySearchBudget(
    rankedTags: RankedTag[],
    parsedFiles: Map<string, ParsedFile>,
    chatRelFnames: Set<string>,
    maxMapTokens: number,
  ): { tree: string; tokens: number } {
    const numTags = rankedTags.length
    let lowerBound = 0
    let upperBound = numTags
    let bestTree = ''
    let bestTreeTokens = 0

    let middle = Math.min(Math.floor(maxMapTokens / 25), numTags)
    const okErr = 0.15
    let guard = 0

    while (lowerBound <= upperBound && guard < 40) {
      guard++
      const tree = this.toTree(rankedTags.slice(0, middle), parsedFiles, chatRelFnames)
      const numTokens = tokenCount(tree)

      const pctErr = maxMapTokens > 0 ? Math.abs(numTokens - maxMapTokens) / maxMapTokens : 0
      if (
        (numTokens <= maxMapTokens && numTokens > bestTreeTokens) ||
        pctErr < okErr
      ) {
        bestTree = tree
        bestTreeTokens = numTokens
        if (pctErr < okErr) break
      }

      if (numTokens < maxMapTokens) {
        lowerBound = middle + 1
      } else {
        upperBound = middle - 1
      }
      middle = Math.floor((lowerBound + upperBound) / 2)
    }

    return { tree: bestTree, tokens: bestTreeTokens }
  }

  /**
   * Serialize a slice of ranked tags into repo-map text.
   * Mirrors repomap.py `to_tree` (lines 748–784).
   */
  private toTree(
    tags: RankedTag[],
    parsedFiles: Map<string, ParsedFile>,
    chatRelFnames: Set<string>,
  ): string {
    if (tags.length === 0) return ''

    const sorted = [...tags].sort((a, b) => {
      const fa = a.type === 'tag' ? a.tag.rel_fname : a.fname
      const fb = b.type === 'tag' ? b.tag.rel_fname : b.fname
      if (fa !== fb) return fa < fb ? -1 : 1
      if (a.type !== b.type) return a.type === 'file' ? -1 : 1
      return 0
    })

    let curFname: string | null = null
    let lois: number[] | null = null
    let output = ''

    // Dummy sentinel to flush the final entry (repomap.py line 760).
    const dummy: RankedTag = { type: 'file', fname: '\u0000__dummy__\u0000' }

    for (const tag of [...sorted, dummy]) {
      const thisRelFname = tag.type === 'tag' ? tag.tag.rel_fname : tag.fname
      if (chatRelFnames.has(thisRelFname)) continue

      if (thisRelFname !== curFname) {
        if (lois !== null && curFname !== null) {
          const parsed = parsedFiles.get(curFname)
          if (parsed) {
            output += '\n' + curFname + ':\n'
            output += renderTreeContext(parsed, lois)
          }
          lois = null
        } else if (curFname !== null) {
          output += '\n' + curFname + '\n'
        }

        if (tag.type === 'tag') {
          lois = []
        }
        curFname = thisRelFname
      }

      if (lois !== null && tag.type === 'tag') {
        lois.push(tag.tag.line)
      }
    }

    // Truncate every line to 100 chars (repomap.py line 779).
    const finalLines = output
      .split('\n')
      .map(l => (l.length > 100 ? l.slice(0, 100) : l))
    return finalLines.join('\n') + '\n'
  }
}

/** Public API. */
export { getTags, loadGrammar } from './parser'
export { tokenCount } from './tokenizer'
export { personalizedPageRank } from './pagerank'
export { buildGraph, runPageRank, computeMul } from './graph'
export { renderTreeContext, renderBareLois } from './tree-context'
export type { ParsedFile, TSNode } from './tree-context'
export type * from './types'
