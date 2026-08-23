import { globSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

const SCOPE = '@maple/'

/**
 * Vendored framework and native-add-on names that live outside the collected
 * packages tree. They are peer dependencies of harness packages but are not
 * graph nodes, so they must not enter the dependency edges.
 */
const NON_GRAPH_DEPS =
  /^@maple\/(cordis(-plugin-[a-z-]+)?|cosmokit|schemastery|node-addon-landlock-run(-linux-(arm64|x64))?)$/

/** A collected package: identity plus its in-repo peer dependencies. */
export interface PackageGraphNode {
  /** Package name with the `@maple/` prefix removed. */
  short: string
  /** Full npm package name. */
  name: string
  /** Directory group under packages/. */
  group: string
  /** Repo-relative package directory. */
  rel: string
  /** Short names of in-repo peer dependencies, sorted. */
  deps: string[]
}

/** Directory order used as the tiebreak inside one dependency layer. */
type GroupOrder = readonly string[]

function topoSort(packages: PackageGraphNode[], groupOrder: GroupOrder, gate: string): PackageGraphNode[] {
  const remaining = new Map(packages.map(pkg => [pkg.short, pkg]))
  const placed = new Set<string>()
  const out: PackageGraphNode[] = []
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter(pkg => pkg.deps.every(dep => placed.has(dep)))
      .sort((a, b) => comparePackages(a, b, groupOrder))
    if (ready.length === 0) throw new Error(`${gate}: dependency cycle among ${[...remaining.keys()].join(', ')}`)
    for (const pkg of ready) {
      out.push(pkg)
      placed.add(pkg.short)
      remaining.delete(pkg.short)
    }
  }
  return out
}

function comparePackages(a: PackageGraphNode, b: PackageGraphNode, groupOrder: GroupOrder): number {
  const groupA = groupOrder.indexOf(a.group)
  const groupB = groupOrder.indexOf(b.group)
  const normA = groupA === -1 ? Number.MAX_SAFE_INTEGER : groupA
  const normB = groupB === -1 ? Number.MAX_SAFE_INTEGER : groupB
  return normA - normB || a.group.localeCompare(b.group) || a.short.localeCompare(b.short)
}

/** Stable Mermaid id for a graph value. */
export function graphNodeId(prefix: string, value: string): string {
  return `${prefix}_${value.replace(/[^a-zA-Z0-9_]/g, '_')}`
}

/** Escape a value embedded in a quoted Mermaid label. */
export function escapeMermaidLabel(value: string): string {
  return value.replace(/"/g, '\\"')
}

/**
 * Collect every scoped harness package under the packages tree with its in-repo
 * dependency edges, ordered so each package follows all of its dependencies.
 * @param root - repository root.
 * @param groupOrder - caller-specific tiebreak order for packages in the same dependency layer.
 * @param gate - command name used in structural error messages.
 * @returns package nodes ordered after all of their in-repo dependencies.
 */
export function collectPackageGraph(root: string, groupOrder: GroupOrder, gate: string): PackageGraphNode[] {
  const packages: PackageGraphNode[] = []
  for (const rel of globSync('packages/*/*/package.json', { cwd: root }).map(path => path.split(sep).join('/')).sort()) {
    const json = JSON.parse(readFileSync(resolve(root, rel), 'utf8')) as {
      name: string
      peerDependencies?: Record<string, string>
    }
    if (!json.name.startsWith(SCOPE)) continue
    const [, group, leaf] = rel.split('/')
    if (group === undefined || leaf === undefined) throw new Error(`${gate}: unexpected package path ${rel}`)
    const deps = Object.keys(json.peerDependencies ?? {})
      .filter(dep => dep.startsWith(SCOPE) && !NON_GRAPH_DEPS.test(dep))
      .map(dep => dep.slice(SCOPE.length))
      .sort()
    packages.push({
      short: json.name.slice(SCOPE.length),
      name: json.name,
      group,
      rel: dirname(rel),
      deps,
    })
  }
  return topoSort(packages, groupOrder, gate)
}
