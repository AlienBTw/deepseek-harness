/**
 * repomap/tree-context.ts — Code-outline renderer (TreeContext port).
 *
 * TypeScript port of `grep_ast.TreeContext` as used by Aider's `render_tree`
 * (repomap.py lines 710–746). Aider's TreeContext is ~1000 lines; this is a
 * faithful ~150-line approximation preserving the output contract:
 *
 *   - Lines of interest (def lines) shown with original source text.
 *   - Parent scope context (enclosing class/function headers) added.
 *   - Elided regions rendered as `⋮...`.
 *   - Every shown line prefixed with a `│` gutter.
 *   - Lines hard-truncated to 100 chars (defense vs minified JS).
 *
 * IMPORTANT: A file is parsed ONCE and all AST data is extracted into PLAIN JS
 * structures (`scopeSpans`, `ancestorHeadersByStartRow`). The tree-sitter tree
 * is then deleted, freeing WASM memory. The renderer never touches WASM node
 * objects — it works purely off the precomputed plain data. This lets the
 * binary-search render loop run safely and leak-free.
 */

/** Node types that count as "definition scopes" for parent-context. */
const SCOPE_NODE_TYPES = new Set([
  // TS/JS
  'class_declaration', 'class', 'function_declaration', 'function_expression',
  'method_definition', 'arrow_function', 'lexical_declaration', 'variable_declaration',
  'interface_declaration', 'type_alias_declaration', 'enum_declaration', 'module',
  'abstract_class_declaration', 'function_signature', 'method_signature',
  // Python
  'class_definition', 'function_definition',
  // Rust
  'struct_item', 'enum_item', 'function_item', 'impl_item', 'trait_item', 'mod_item',
  // Go
  'type_declaration',
])

/** Minimal tree-sitter Node shape we walk during pre-extraction. */
export interface TSNode {
  type: string
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  parent: TSNode | null
  children: TSNode[]
  text: string
}

/** A pre-parsed file, reusable across renders. Contains NO WASM node refs. */
export interface ParsedFile {
  rel_fname: string
  source: string
  lines: string[]
  /** All scope definition spans, sorted by startRow. */
  scopeSpans: Array<{ startRow: number; endRow: number }>
  /** For each scope node's startRow, the startRows of its enclosing scopes. */
  ancestorHeadersByStartRow: Map<number, number[]>
}

/**
 * Walk a tree-sitter tree ONCE and extract all scope data as plain JS.
 *
 * Returns:
 *   - scopeSpans: every scope node's [startRow, endRow]
 *   - ancestorHeadersByStartRow: for each scope node's startRow, the startRows
 *     of its enclosing scope nodes (walked up via .parent)
 *
 * After this returns, the tree-sitter tree can be safely deleted.
 */
export function collectScopeNodes(rootNode: TSNode | null): {
  scopeSpans: Array<{ startRow: number; endRow: number }>
  ancestorHeadersByStartRow: Map<number, number[]>
} {
  const scopeSpans: Array<{ startRow: number; endRow: number }> = []
  const ancestorHeadersByStartRow = new Map<number, number[]>()

  if (!rootNode) return { scopeSpans, ancestorHeadersByStartRow }

  // Iterative DFS with parent tracking. We pass the chain of enclosing scope
  // nodes so each scope node can record its ancestor headers in O(1).
  const stack: Array<{ node: TSNode; scopeAncestors: number[] }> = [
    { node: rootNode, scopeAncestors: [] },
  ]

  while (stack.length > 0) {
    const popped = stack.pop()
    if (!popped) continue
    const { node, scopeAncestors } = popped
    const isScope = SCOPE_NODE_TYPES.has(node.type)
    const startRow = node.startPosition.row

    if (isScope) {
      scopeSpans.push({ startRow, endRow: node.endPosition.row })
      // Record this scope's ancestor header rows (a copy).
      ancestorHeadersByStartRow.set(startRow, [...scopeAncestors])
    }

    // For children, the scope-ancestor chain includes this node if it's a scope.
    const childAncestors = isScope ? [...scopeAncestors, startRow] : scopeAncestors
    // Push children in reverse so they're processed in source order.
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ node: node.children[i], scopeAncestors: childAncestors })
    }
  }

  scopeSpans.sort((a, b) => a.startRow - b.startRow)
  return { scopeSpans, ancestorHeadersByStartRow }
}

/**
 * Render a file's context tree for the given lines of interest.
 *
 * @param parsed  the pre-parsed file (plain JS data, no WASM refs)
 * @param lois    0-based line numbers of interest (def lines)
 * @returns       rendered string (WITHOUT the file header); caller adds header.
 */
export function renderTreeContext(parsed: ParsedFile, lois: number[]): string {
  if (lois.length === 0) return ''
  const { lines, scopeSpans, ancestorHeadersByStartRow } = parsed

  // Build the display line set: LOIs + ancestor scope headers.
  const displayLines = new Set<number>()
  for (const loi of lois) {
    displayLines.add(loi)
    const ancestors = ancestorHeadersByStartRow.get(loi)
    if (ancestors) {
      for (const a of ancestors) displayLines.add(a)
    } else {
      // loi isn't a scope start; find the innermost scope containing it and
      // add that scope's header (and its ancestors) as context.
      let best: { startRow: number } | null = null
      let bestSpan = Infinity
      for (const sn of scopeSpans) {
        if (loi >= sn.startRow && loi <= sn.endRow && sn.endRow - sn.startRow < bestSpan) {
          best = sn
          bestSpan = sn.endRow - sn.startRow
        }
      }
      if (best) {
        displayLines.add(best.startRow)
        const anc = ancestorHeadersByStartRow.get(best.startRow)
        if (anc) for (const a of anc) displayLines.add(a)
      }
    }
  }

  // Sort and group into consecutive runs.
  const sorted = [...displayLines].sort((a, b) => a - b)
  const runs: number[][] = []
  let current: number[] = []
  for (const ln of sorted) {
    if (current.length === 0 || ln === current[current.length - 1] + 1) {
      current.push(ln)
    } else {
      runs.push(current)
      current = [ln]
    }
  }
  if (current.length > 0) runs.push(current)

  // Render.
  const out: string[] = []
  if (sorted[0] > 0) out.push('⋮...')

  for (let r = 0; r < runs.length; r++) {
    for (const ln of runs[r]) {
      const src = lines[ln] ?? ''
      const truncated = src.length > 100 ? src.slice(0, 100) : src
      out.push('│' + truncated)
    }
    if (r < runs.length - 1) out.push('⋮...')
  }
  if (sorted[sorted.length - 1] < lines.length - 1) out.push('⋮...')

  return out.join('\n') + '\n'
}

/** Bare LOI renderer (no parent context) — used when parsing failed. */
export function renderBareLois(source: string, lois: number[]): string {
  const lines = source.split(/\r?\n/)
  const sorted = [...lois].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const out: string[] = []
  if (sorted[0] > 0) out.push('⋮...')
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] > sorted[i - 1] + 1) out.push('⋮...')
    const src = lines[sorted[i]] ?? ''
    out.push('│' + (src.length > 100 ? src.slice(0, 100) : src))
  }
  if (sorted[sorted.length - 1] < lines.length - 1) out.push('⋮...')
  return out.join('\n') + '\n'
}
