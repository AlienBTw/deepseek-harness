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

export interface ParsedFile {
  rel_fname: string
  source: string
  lines: string[]
  scopeSpans: Array<{ startRow: number; endRow: number }>
  ancestorHeadersByStartRow: Map<number, number[]>
}

export function parseFileForRendering(
  rel_fname: string,
  source: string,
  rootNode: TSNode | null
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
    if (current.length === 0 || (current[current.length - 1] !== undefined && ln === current[current.length - 1]! + 1)) {
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
      const prefix = displayLines.has(ln) ? ' ' : ' '
      out.push(`${prefix} ${src}`)
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
