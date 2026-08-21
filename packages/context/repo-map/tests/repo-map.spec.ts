import { describe, it, expect } from 'vitest'
import { RepoMap } from '../src/repomap.ts'
import { personalizedPageRank } from '../src/pagerank.ts'
import { langForFile } from '../src/queries.ts'
import { tokenCount } from '../src/tokenizer.ts'
import type { Tag, SourceFile } from '../src/types.ts'

describe('@maple/context-repo-map', () => {
  it('identifies all 14 supported languages correctly', () => {
    const testCases: Array<[string, string]> = [
      ['app.ts', 'typescript'],
      ['App.tsx', 'tsx'],
      ['index.js', 'javascript'],
      ['script.py', 'python'],
      ['main.rs', 'rust'],
      ['server.go', 'go'],
      ['main.c', 'c'],
      ['engine.cpp', 'cpp'],
      ['Model.cs', 'c_sharp'],
      ['App.java', 'java'],
      ['index.php', 'php'],
      ['user.rb', 'ruby'],
      ['Main.kt', 'kotlin'],
      ['App.swift', 'swift'],
    ]

    for (const [file, expectedLang] of testCases) {
      expect(langForFile(file)).toBe(expectedLang)
    }
  })

  it('runs personalized PageRank algorithm accurately', () => {
    const nodes = ['fileA.ts', 'fileB.ts', 'fileC.ts']
    const outEdges = new Map([
      ['fileA.ts', [{ dst: 'fileB.ts', weight: 1 }]],
      ['fileB.ts', [{ dst: 'fileC.ts', weight: 1 }]],
      ['fileC.ts', [{ dst: 'fileA.ts', weight: 1 }]],
    ])
    const outWeight = new Map([
      ['fileA.ts', 1],
      ['fileB.ts', 1],
      ['fileC.ts', 1],
    ])
    const personalization = new Map([['fileA.ts', 10.0]])

    const result = personalizedPageRank({
      nodes,
      outEdges,
      outWeight,
      personalization,
    })

    expect(result.converged).toBe(true)
    expect(result.ranks.get('fileA.ts')).toBeGreaterThan(result.ranks.get('fileC.ts')!)
  })

  it('generates a repo-map with mock tags', async () => {
    const mockGetTags = async (rel_fname: string): Promise<Tag[]> => {
      if (rel_fname === 'src/math.ts') {
        return [
          {
            rel_fname,
            fname: rel_fname,
            line: 0,
            name: 'add',
            kind: 'def',
          },
        ]
      }
      if (rel_fname === 'src/main.ts') {
        return [
          {
            rel_fname,
            fname: rel_fname,
            line: 1,
            name: 'add',
            kind: 'ref',
          },
        ]
      }
      return []
    }

    const repoMap = new RepoMap({ getTags: mockGetTags })
    const sourceFiles: SourceFile[] = [
      {
        rel_fname: 'src/math.ts',
        fname: 'src/math.ts',
        content: 'export function add(a: number, b: number) { return a + b; }',
      },
      {
        rel_fname: 'src/main.ts',
        fname: 'src/main.ts',
        content: 'import { add } from "./math";\nconsole.log(add(1, 2));',
      },
    ]

    const result = await repoMap.getRepoMap({
      sourceFiles,
      maxMapTokens: 500,
    })

    expect(result).toBeDefined()
    expect(result.repoMap).toBeDefined()
    expect(result.repoMap.length).toBeGreaterThan(0)
    expect(tokenCount(result.repoMap)).toBeLessThanOrEqual(500)
  })
})
