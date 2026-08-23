/**
 * repomap/tree-context.ts — Pure-JS AST scope outline renderer.
 *
 * Faithful port of Aider's TreeContext (tree_context.py lines 1-177).
 */


export interface TSNode {
  type: string
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  childCount: number
  child(index: number): TSNode | null
  namedChild(index: number): TSNode | null
  namedChildCount: number
}

const SCOPE_NODE_TYPES = new Set([
  'function_declaration',
  'function_definition',
  'method_definition',
  'method_declaration',
  'class_declaration',
  'class_definition',
  'interface_declaration',
  'struct_item',
  'impl_item',
  'trait_item',
  'type_alias_declaration',
  'enum_declaration',
  'decorated_definition',
])

/**
 * One file pre-parsed into plain-JS rendering data. The WASM tree is freed
 * after this shape is built, so the renderer never touches live AST nodes;
 * the binary search over the token budget re-renders from it cheaply.
 */
export interface ParsedFile {
  /** Path relative to the repository root; the renderer's grouping key. */
  rel_fname: string
  /** Full source text the lines were split from. */
  source: string
  /** Source split on newlines; indexed by the zero-based rows elsewhere here. */
  lines: string[]
  /** Spans of scope-defining nodes (functions, classes, …), innermost first in discovery order. */
  scopeSpans: Array<{ startRow: number; endRow: number }>
  /** For each scope's start row, the start rows of its enclosing scopes. */
  ancestorHeadersByStartRow: Map<number, number[]>
}

/**
 * Build one file's plain-JS rendering data from its parsed AST, freeing the
 * caller from any further WASM-node access.
 * @param rel_fname - path relative to the repository root.
 * @param source - full file source text.
 * @param rootNode - the parsed tree root, or `null` when parsing failed.
 * @returns the rendering data {@link renderTreeContext} consumes.
 */
export function parseFileForRendering(
  rel_fname: string,
  source: string,
  rootNode: TSNode | null,
): ParsedFile {
  const lines = source.split('\n')
  const { scopeSpans, ancestorHeadersByStartRow } = collectScopeNodes(rootNode)
  return {
    rel_fname,
    source,
    lines,
    scopeSpans,
    ancestorHeadersByStartRow,
  }
}

/**
 * Walk the AST collecting scope spans and each scope's ancestor-header chain
 * as plain JS, so the WASM tree can be freed immediately after parsing.
 * @param rootNode - the parsed tree root, or `null` when parsing failed.
 * @returns the scope data one {@link ParsedFile} carries.
 */
export function collectScopeNodes(rootNode: TSNode | null): {
  scopeSpans: Array<{ startRow: number; endRow: number }>
  ancestorHeadersByStartRow: Map<number, number[]>
} {
  const scopeSpans: Array<{ startRow: number; endRow: number }> = []
  const ancestorHeadersByStartRow = new Map<number, number[]>()
  if (!rootNode) return { scopeSpans, ancestorHeadersByStartRow }

  const stack: Array<{ node: TSNode; scopeAncestors: number[] }> = [
    { node: rootNode, scopeAncestors: [] },
  ]

  while (stack.length > 0) {
    const popped = stack.pop()
    if (!popped) continue
    const { node, scopeAncestors } = popped
    const isScope = SCOPE_NODE_TYPES.has(node.type)

    let nextAncestors = scopeAncestors
    if (isScope) {
      const startRow = node.startPosition.row
      const endRow = node.endPosition.row
      scopeSpans.push({ startRow, endRow })
      ancestorHeadersByStartRow.set(startRow, scopeAncestors)
      nextAncestors = [...scopeAncestors, startRow]
    }

    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i)
      if (child) {
        stack.push({ node: child, scopeAncestors: nextAncestors })
      }
    }
  }

  return { scopeSpans, ancestorHeadersByStartRow }
}

/**
 * Render the lines-of-interest for one file with their enclosing scope
 * headers, eliding uninteresting runs behind an ellipsis line — the per-file
 * body of a ranked repo map.
 * @param parsed - the pre-parsed rendering data for this file.
 * @param lois - zero-based line numbers of the symbols this file was ranked for.
 * @returns the rendered text, empty when there are no lines to show.
 */
export function renderTreeContext(parsed: ParsedFile, lois: number[]): string {
  if (lois.length === 0) return ''
  const { lines, scopeSpans, ancestorHeadersByStartRow } = parsed

  const displayLines = new Set<number>()
  for (const loi of lois) {
    displayLines.add(loi)
    const ancestors = ancestorHeadersByStartRow.get(loi)
    if (ancestors) {
      for (const a of ancestors) displayLines.add(a)
    } else {
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

  const sorted = [...displayLines].sort((a, b) => a - b)
  const runs: number[][] = []
  let current: number[] = []
  for (const ln of sorted) {
    const last = current[current.length - 1]
    if (last === undefined || ln === last + 1) {
      current.push(ln)
    } else {
      runs.push(current)
      current = [ln]
    }
  }
  if (current.length > 0) runs.push(current)

  const out: string[] = []
  const firstLn = sorted[0]
  if (firstLn !== undefined && firstLn > 0) out.push('⋮...')

  for (let r = 0; r < runs.length; r++) {
    const run = runs[r]
    if (!run) continue
    for (const ln of run) {
      const src = lines[ln] ?? ''
      // Both arms of the ported ternary rendered the same space; keep the
      // two-space prefix byte-for-byte.
      out.push(`  ${src}`)
    }
    const nextRun = runs[r + 1]
    const lastInRun = run[run.length - 1]
    if (nextRun && lastInRun !== undefined && nextRun[0] !== undefined) {
      const gap = nextRun[0] - lastInRun - 1
      if (gap > 0) out.push('⋮...')
    }
  }

  const lastRun = runs[runs.length - 1]
  const lastLn = lastRun ? lastRun[lastRun.length - 1] : undefined
  if (lastLn !== undefined && lastLn < lines.length - 1) {
    out.push('⋮...')
  }

  return out.join('\n')
}

/**
 * Render lines-of-interest without scope context — the fallback for files
 * whose parse failed, so a map still shows the ranked lines bare.
 * @param source - full file source text.
 * @param lois - zero-based line numbers to show, in any order.
 * @returns the rendered text with ellipsis lines between disjoint runs.
 */
export function renderBareLois(source: string, lois: Set<number>): string {
  const lines = source.split('\n')
  const out: string[] = []
  const sorted = [...lois].sort((a, b) => a - b)
  let last = -1
  for (const ln of sorted) {
    if (last !== -1 && ln > last + 1) out.push('⋮...')
    const text = lines[ln] ?? ''
    out.push(`  ${text}`)
    last = ln
  }
  if (last !== -1 && last < lines.length - 1) out.push('⋮...')
  return out.join('\n')
}
