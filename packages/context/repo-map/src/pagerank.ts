/**
 * repomap/pagerank.ts — Personalized PageRank via power iteration.
 *
 * Ported from NetworkX's `nx.pagerank` as used by Aider (repomap.py lines 519–531),
 * with these exact parameters:
 *   - alpha (damping) = 0.85
 *   - weight = "weight"
 *   - personalization = { chat/mentioned files: 100/N each } (missing nodes -> 1/N)
 *   - dangling = personalization (dangling mass redistributed per personalization)
 *   - max_iter = 1000, tol = 1e-6
 *
 * This is a self-contained ~60-line power-iteration implementation. No graph library.
 *
 * The graph is represented as:
 *   nodes: string[]
 *   outEdges: Map<src, Array<{ dst, weight }>>  (parallel edges pre-summed per (src,dst))
 *   outWeight: Map<src, number>  (sum of out-edge weights; 0 => dangling node)
 *
 * Personalization: a Map<node, score>. Missing nodes receive 1/N. The vector is then
 * normalized to sum to 1 (matching NetworkX behavior).
 */

export interface PageRankInput {
  nodes: string[]
  outEdges: Map<string, Array<{ dst: string; weight: number }>>
  outWeight: Map<string, number>
  personalization: Map<string, number>
  alpha?: number
  maxIter?: number
  tol?: number
}

/** Converged ranks plus the iteration accounting that produced them. */
export interface PageRankOutput {
  /** Final PageRank per node. */
  ranks: Map<string, number>
  /** Iterations actually executed. */
  iterations: number
  /** Whether the tolerance was met before the iteration cap. */
  converged: boolean
}

/**
 * Run personalized PageRank with dangling handling.
 *
 * Formula (per iteration):
 *   newPR[dst] = alpha * ( trans[dst] + danglingMass * P[dst] ) + (1 - alpha) * P[dst]
 *
 * where:
 *   trans[dst]   = sum over src of (weight(src->dst) / outWeight[src]) * PR[src]
 *   danglingMass = sum of PR[src] for src with outWeight[src] === 0
 *   P            = normalized personalization vector (sums to 1)
 * @param input - nodes, weighted out-edges, and the personalization vector.
 * @returns converged node ranks with iteration accounting.
 */
export function personalizedPageRank(input: PageRankInput): PageRankOutput {
  const {
    nodes,
    outEdges,
    outWeight,
    personalization,
    alpha = 0.85,
    maxIter = 1000,
    tol = 1e-6,
  } = input

  const N = nodes.length
  if (N === 0) {
    return { ranks: new Map(), iterations: 0, converged: true }
  }

  // Build personalization vector P: missing nodes get 1/N, then normalize to sum 1.
  // (This mirrors NetworkX: `p = dict.fromkeys(W, 1.0/N); p.update(personalization); s=sum; p/=s`.)
  const P = new Map<string, number>()
  let pSum = 0
  for (const n of nodes) {
    const v = personalization.has(n) ? (personalization.get(n) as number) : 1 / N
    P.set(n, v)
    pSum += v
  }
  if (pSum === 0) {
    // Degenerate: no personalization anywhere. Fall back to uniform.
    for (const n of nodes) P.set(n, 1 / N)
    pSum = 1
  }
  for (const n of nodes) {
    P.set(n, (P.get(n) as number) / pSum)
  }

  // Initialize PR uniformly.
  const PR = new Map<string, number>()
  for (const n of nodes) PR.set(n, 1 / N)

  let iterations = 0
  let converged = false

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1

    // Compute dangling mass: sum of PR over nodes with no out-edges.
    let danglingMass = 0
    for (const n of nodes) {
      if ((outWeight.get(n) ?? 0) === 0) {
        danglingMass += PR.get(n) as number
      }
    }

    const newPR = new Map<string, number>()

    // First: teleportation + dangling contribution (applies to every node).
    for (const n of nodes) {
      const p = P.get(n) as number
      newPR.set(n, alpha * danglingMass * p + (1 - alpha) * p)
    }

    // Then: transition contribution (only nodes with out-edges push rank).
    for (const src of nodes) {
      const ow = outWeight.get(src) ?? 0
      if (ow === 0) continue
      const srcRank = PR.get(src) as number
      const edges = outEdges.get(src)
      if (!edges) continue
      for (const { dst, weight } of edges) {
        const contribution = (weight / ow) * srcRank
        newPR.set(dst, (newPR.get(dst) as number) + alpha * contribution)
      }
    }

    // Convergence check (L1 norm).
    let diff = 0
    for (const n of nodes) {
      diff += Math.abs((newPR.get(n) as number) - (PR.get(n) as number))
      PR.set(n, newPR.get(n) as number)
    }

    if (diff < tol) {
      converged = true
      break
    }
  }

  return { ranks: PR, iterations, converged }
}
