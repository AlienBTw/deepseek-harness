/**
 * repomap/types.ts — Core types for the RepoMap engine.
 *
 * Ported from Aider's `aider/repomap.py` (Tag namedtuple + graph helpers).
 * Faithful to the original 5-field Tag tuple: (rel_fname, fname, line, name, kind).
 */

/** A symbol tag extracted from a source file via tree-sitter. */
export interface Tag {
  /** Path relative to repo root (string). */
  rel_fname: string
  /** Absolute path (string). */
  fname: string
  /** 0-based line number where the defining/referencing identifier starts. */
  line: number
  /** The identifier text (e.g. "renderTree", "User", "foo"). */
  name: string
  /** "def" for definitions, "ref" for references. */
  kind: 'def' | 'ref'
}

/** A directed, weighted edge in the reference multigraph. */
export interface GraphEdge {
  /** Source node = the file that references the ident. */
  src: string
  /** Destination node = the file that defines the ident. */
  dst: string
  /** The identifier this edge is about. */
  ident: string
  /** Edge weight (mul * sqrt(num_refs), with chat boost). */
  weight: number
}

/** The complete reference graph built from a repo's tags. */
export interface RefGraph {
  /** All file nodes (rel_fname strings). */
  nodes: Set<string>
  /** Multigraph: src -> dst -> ident -> weight. Combines parallel edges by ident. */
  edges: Map<string, Map<string, Map<string, number>>>
  /** Total outgoing weight per source node (precomputed for PageRank). */
  outWeight: Map<string, number>
}

/** A (definer_file, ident) pair with its accumulated PageRank-derived score. */
export interface RankedDefinition {
  fname: string
  ident: string
  rank: number
}

/** Per-file PageRank score (node-level, before rank distribution). */
export interface NodeRank {
  fname: string
  rank: number
}

/** A ranked tag ready for rendering (either a real Tag or a tag-less file sentinel). */
export type RankedTag =
  | { type: 'tag'; tag: Tag }
  | { type: 'file'; fname: string } // 1-tuple sentinel: file with no ranked defs

/** Options controlling repo-map generation. */
export interface RepoMapOptions {
  /** Max tokens the rendered map may consume. Default 2000. */
  maxMapTokens?: number
  /** Files currently in the chat context (absolute or rel — caller decides). */
  chatFnames?: string[]
  /** Other files to consider (not in chat). */
  otherFnames?: string[]
  /** Identifier names explicitly mentioned by the user (boost personalization). */
  mentionedIdents?: string[]
  /** Files mentioned by name (boost personalization). */
  mentionedFnames?: string[]
  /** PageRank damping factor. Default 0.85 (NetworkX/Aider default). */
  pagerankAlpha?: number
  /** PageRank max iterations. Default 1000. */
  pagerankMaxIter?: number
  /** PageRank convergence tolerance. Default 1e-6. */
  pagerankTol?: number
}

/** A file with its source content, for the engine to parse. */
export interface SourceFile {
  /** Relative path from repo root. */
  rel_fname: string
  /** Absolute or canonical path (may equal rel_fname). */
  fname: string
  /** Raw source text. */
  content: string
}

/** Full result of a repo-map computation, for visualization & testing. */
export interface RepoMapResult {
  /** The final token-budgeted repo-map string. */
  repoMap: string
  /** All extracted tags (defs + refs), flat. */
  tags: Tag[]
  /** The reference multigraph (serialized form for transport). */
  graph: {
    nodes: string[]
    edges: Array<{ src: string; dst: string; ident: string; weight: number }>
  }
  /** Per-node PageRank scores (sorted desc). */
  nodeRanks: NodeRank[]
  /** Per (definer, ident) distributed ranks (sorted desc). */
  rankedDefinitions: RankedDefinition[]
  /** The ranked tag list (before truncation). */
  rankedTags: RankedTag[]
  /** Final token count of the rendered map. */
  tokenCount: number
  /** Stats about the run. */
  stats: {
    fileCount: number
    tagCount: number
    defCount: number
    refCount: number
    edgeCount: number
    pagerankIterations: number
    pagerankConverged: boolean
    renderTimeMs: number
  }
}
