/**
 * repomap/graph.ts — Reference graph construction + rank distribution.
 *
 * Faithful port of Aider's `get_ranked_tags` graph-building phase (repomap.py
 * lines 365–545). Key invariants preserved:
 *
 *   - Nodes are files (rel_fname).
 *   - Edges go REFERENCER -> DEFINER (repomap.py line 508: G.add_edge(referencer, definer)).
 *   - Self-references are NOT skipped (the `if referencer == definer: continue`
 *     is commented out in Aider — see repomap.py lines 504–505).
 *   - Edge weight = mul(ident) * (50 if referencer in chat else 1) * sqrt(num_refs).
 *   - Def-only idents (defined but never referenced) get a weight-0.1 self-edge.
 *   - personalization = { chat/mentioned files: 100/N each }; others get 1/N at PageRank time.
 *   - mul rules: x10 if ident mentioned; x10 if snake/kebab/camel AND len>=8;
 *     x0.1 if ident starts with "_"; x0.1 if defined in >5 files.
 *   - Rank distribution: each node's PageRank is split across its out-edges by weight;
 *     the destination is a definer, so rank accumulates per (definer_fname, ident).
 */

import type { RankedDefinition, RefGraph, Tag } from './types'
import { personalizedPageRank, type PageRankOutput } from './pagerank'

/** Whether an identifier "looks meaningful" per Aider's heuristics. */
function identCasings(ident: string): {
  isSnake: boolean
  isKebab: boolean
  isCamel: boolean
} {
  const isSnake = ident.includes('_') && /[a-zA-Z]/.test(ident)
  const isKebab = ident.includes('-') && /[a-zA-Z]/.test(ident)
  const isCamel = /[A-Z]/.test(ident) && /[a-z]/.test(ident)
  return { isSnake, isKebab, isCamel }
}

/** Compute the per-ident `mul` weight multiplier (repomap.py lines 487–499). */
export function computeMul(
  ident: string,
  definerCount: number,
  mentionedIdents: Set<string>,
): number {
  let mul = 1.0
  const { isSnake, isKebab, isCamel } = identCasings(ident)

  if (mentionedIdents.has(ident)) mul *= 10
  if ((isSnake || isKebab || isCamel) && ident.length >= 8) mul *= 10
  if (ident.startsWith('_')) mul *= 0.1
  if (definerCount > 5) mul *= 0.1
  return mul
}

export interface BuildGraphInput {
  tags: Tag[]
  chatRelFnames: Set<string>
  mentionedRelFnames: Set<string>
  mentionedIdents: Set<string>
}

export interface BuildGraphOutput {
  graph: RefGraph
  /** name -> set of rel_fnames that define it. */
  defines: Map<string, Set<string>>
  /** name -> list of rel_fnames that reference it (with duplicates). */
  references: Map<string, string[]>
  /** (rel_fname, name) -> array of def Tags. */
  definitions: Map<string, Tag[]>
  /** All idents that are BOTH defined and referenced. */
  idents: Set<string>
  /** Personalization vector: rel_fname -> score (chat/mentioned files only). */
  personalization: Map<string, number>
  /** Number of files (for the 100/N personalization base). */
  fileCount: number
}

/**
 * Build the reference multigraph and personalization vector from tags.
 *
 * Returns the graph plus the intermediate maps needed for rank distribution
 * and final tag rendering.
 */
export function buildGraph(input: BuildGraphInput): BuildGraphOutput {
  const { tags, chatRelFnames, mentionedRelFnames, mentionedIdents } = input

  const defines = new Map<string, Set<string>>()
  const references = new Map<string, string[]>()
  const definitions = new Map<string, Tag[]>()
  const personalization = new Map<string, number>()

  // Collect all distinct files (nodes).
  const allFiles = new Set<string>()
  for (const tag of tags) allFiles.add(tag.rel_fname)

  // Personalization base: 100 / num_files (repomap.py line 383).
  const personalize = allFiles.size > 0 ? 100 / allFiles.size : 0

  // Build defines / references / definitions from tags.
  // NOTE: Aider keys references as a LIST (duplicates matter for Counter/sqrt),
  // and definitions as a SET of Tag tuples (dedup). We replicate both.
  for (const tag of tags) {
    if (tag.kind === 'def') {
      if (!defines.has(tag.name)) defines.set(tag.name, new Set())
      defines.get(tag.name)?.add(tag.rel_fname)

      const key = `${tag.rel_fname}\u0000${tag.name}`
      if (!definitions.has(key)) definitions.set(key, [])
      // Dedup by (rel_fname, name, line) — Tags at the same line are identical.
      const arr = definitions.get(key) ?? []
      const exists = arr.some(t => t.line === tag.line)
      if (!exists) arr.push(tag)
    } else if (tag.kind === 'ref') {
      if (!references.has(tag.name)) references.set(tag.name, [])
      references.get(tag.name)?.push(tag.rel_fname)
    }
  }

  // Personalization per file (repomap.py lines 400–458).
  for (const fname of allFiles) {
    let currentPers = 0
    if (chatRelFnames.has(fname)) {
      currentPers += personalize
    }
    if (mentionedRelFnames.has(fname)) {
      // max, not add (chat+mentioned caps at personalize).
      currentPers = Math.max(currentPers, personalize)
    }
    // mentioned_idents matched against path components / basenames.
    // (We skip the path-component matching here for simplicity; it only adds
    //  a `+ personalize` boost. Mentioned idents are handled via the x10 mul.)
    if (currentPers > 0) personalization.set(fname, currentPers)
  }

  // Empty-references fallback (repomap.py lines 465–466): if NO refs anywhere,
  // treat every definer as referencing itself.
  let refsTotal = 0
  for (const lst of references.values()) refsTotal += lst.length
  if (refsTotal === 0) {
    for (const [name, definers] of defines) {
      references.set(name, [...definers])
    }
  }

  // idents = defines ∩ references (repomap.py line 468).
  const idents = new Set<string>()
  for (const name of defines.keys()) {
    if (references.has(name)) idents.add(name)
  }

  // Build the multigraph as src -> dst -> ident -> weight.
  const edges = new Map<string, Map<string, Map<string, number>>>()
  const outWeight = new Map<string, number>()
  const nodes = new Set<string>(allFiles)

  const addEdge = (src: string, dst: string, ident: string, weight: number) => {
    if (!edges.has(src)) edges.set(src, new Map())
    const inner = edges.get(src) ?? new Map()
    if (!inner.has(dst)) inner.set(dst, new Map())
    const innermost = inner.get(dst) ?? new Map()
    innermost.set(ident, (innermost.get(ident) ?? 0) + weight)
    outWeight.set(src, (outWeight.get(src) ?? 0) + weight)
  }

  // Self-edges (weight 0.1) for def-only idents (repomap.py lines 472–479).
  for (const name of defines.keys()) {
    if (references.has(name)) continue
    for (const definer of (defines.get(name) ?? [])) {
      addEdge(definer, definer, name, 0.1)
    }
  }

  // Main edge construction (repomap.py lines 481–514).
  for (const ident of idents) {
    const definers = defines.get(ident) ?? new Set()
    const refs = references.get(ident) ?? []
    const mul = computeMul(ident, definers.size, mentionedIdents)

    // Count refs per referencer file (Counter(references[ident])).
    const refCounter = new Map<string, number>()
    for (const r of refs) refCounter.set(r, (refCounter.get(r) ?? 0) + 1)

    for (const [referencer, numRefs] of refCounter) {
      for (const definer of definers) {
        // Self-references NOT skipped (Aider's `continue` is commented out).
        let useMul = mul
        if (chatRelFnames.has(referencer)) useMul *= 50
        // sqrt scaling to dampen high-frequency refs (repomap.py line 511).
        const weight = useMul * Math.sqrt(numRefs)
        addEdge(referencer, definer, ident, weight)
      }
    }
  }

  return {
    graph: { nodes, edges, outWeight },
    defines,
    references,
    definitions,
    idents,
    personalization,
    fileCount: allFiles.size,
  }
}

export interface RunPageRankInput {
  graph: RefGraph
  personalization: Map<string, number>
  fileCount: number
  alpha?: number
  maxIter?: number
  tol?: number
}

export interface RunPageRankOutput {
  pagerank: PageRankOutput
  /** Distributed rank per (definer_fname, ident). */
  rankedDefinitions: Map<string, number>
}

/**
 * Run personalized PageRank and distribute rank across out-edges to compute
 * per-(definer, ident) scores. Mirrors repomap.py lines 519–545.
 */
export function runPageRank(input: RunPageRankInput): RunPageRankOutput {
  const { graph, personalization, alpha = 0.85, maxIter = 1000, tol = 1e-6 } = input

  const nodes = [...graph.nodes]
  const outEdges = new Map<string, Array<{ dst: string; weight: number }>>()
  for (const [src, inner] of graph.edges) {
    const list: Array<{ dst: string; weight: number }> = []
    for (const [dst, identMap] of inner) {
      let total = 0
      for (const w of identMap.values()) total += w
      list.push({ dst, weight: total })
    }
    outEdges.set(src, list)
  }

  const pagerank = personalizedPageRank({
    nodes,
    outEdges,
    outWeight: graph.outWeight,
    personalization,
    alpha,
    maxIter,
    tol,
  })

  // Distribute rank across out-edges, accumulating per (dst=definer, ident).
  // repomap.py lines 533–545.
  const rankedDefinitions = new Map<string, number>()
  for (const src of graph.nodes) {
    const srcRank = pagerank.ranks.get(src) ?? 0
    const inner = graph.edges.get(src)
    if (!inner) continue
    for (const [dst, identMap] of inner) {
      let totalWeight = 0
      for (const w of identMap.values()) totalWeight += w
      if (totalWeight === 0) continue
      for (const [ident, w] of identMap) {
        const rank = (srcRank * w) / totalWeight
        const key = `${dst}\u0000${ident}`
        rankedDefinitions.set(key, (rankedDefinitions.get(key) ?? 0) + rank)
      }
    }
  }

  return { pagerank, rankedDefinitions }
}

/**
 * Build the ranked tag list from distributed ranks.
 *
 * Mirrors repomap.py lines 547–572:
 *   - Sort ranked_definitions by (rank, (fname, ident)) DESC.
 *   - Skip defs in chat files (already in chat context).
 *   - Append the actual Tag objects for each (fname, ident).
 *   - Append 1-tuple (fname,) sentinels for tag-less files, sorted by node PageRank.
 */
export function buildRankedTags(
  rankedDefinitions: Map<string, number>,
  definitions: Map<string, Tag[]>,
  nodeRanks: Map<string, number>,
  chatRelFnames: Set<string>,
  allRelFnames: Set<string>,
): Array<{ type: 'tag'; tag: Tag } | { type: 'file'; fname: string }> {
  const rankedDefs: Array<{ fname: string; ident: string; rank: number }> = []
  for (const [key, rank] of rankedDefinitions) {
    const [fname, ident] = key.split('\u0000')
    rankedDefs.push({ fname, ident, rank })
  }
  // Sort by (rank, (fname, ident)) DESC — matches repomap.py line 550.
  rankedDefs.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank
    const ka = `${a.fname}\u0000${a.ident}`
    const kb = `${b.fname}\u0000${b.ident}`
    return kb < ka ? -1 : kb > ka ? 1 : 0
  })

  const rankedTags: Array<{ type: 'tag'; tag: Tag } | { type: 'file'; fname: string }> = []
  const fnamesAlreadyIncluded = new Set<string>()

  for (const { fname, ident } of rankedDefs) {
    if (chatRelFnames.has(fname)) continue // skip chat-file defs
    const key = `${fname}\u0000${ident}`
    const tags = definitions.get(key)
    if (tags && tags.length > 0) {
      for (const tag of tags) {
        rankedTags.push({ type: 'tag', tag })
        fnamesAlreadyIncluded.add(tag.rel_fname)
      }
    }
  }

  // Append tag-less files (1-tuple sentinels), sorted by node PageRank desc.
  const topRank = [...nodeRanks.entries()].sort((a, b) => b[1] - a[1])
  const relOtherWithoutTags = new Set<string>()
  for (const f of allRelFnames) {
    if (!definitions.has(`${f}\u0000`) && !fnamesAlreadyIncluded.has(f)) {
      // Heuristic: a file is "tag-less" if it has no def entries at all.
      relOtherWithoutTags.add(f)
    }
  }
  // Files with node PageRank first (in rank order), then the rest.
  for (const [fname] of topRank) {
    if (relOtherWithoutTags.has(fname)) {
      relOtherWithoutTags.delete(fname)
      if (!fnamesAlreadyIncluded.has(fname)) {
        rankedTags.push({ type: 'file', fname })
      }
    }
  }
  for (const fname of relOtherWithoutTags) {
    if (!fnamesAlreadyIncluded.has(fname)) {
      rankedTags.push({ type: 'file', fname })
    }
  }

  return rankedTags
}

/** Flatten ranked definitions for export/visualization. */
export function rankedDefinitionsToArray(
  rankedDefinitions: Map<string, number>,
): RankedDefinition[] {
  const out: RankedDefinition[] = []
  for (const [key, rank] of rankedDefinitions) {
    const [fname, ident] = key.split('\u0000')
    out.push({ fname, ident, rank })
  }
  out.sort((a, b) => b.rank - a.rank || (a.fname < b.fname ? -1 : 1))
  return out
}
