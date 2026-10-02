/**
 * Focused coverage for the setTimeout-in-tests gate helpers.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const allowlistPath = resolve(root, 'scripts/settimeout-test-allowlist.json')

describe('settimeout-test-allowlist', () => {
  it('lists unique sorted repo-relative package test paths', () => {
    const doc = JSON.parse(readFileSync(allowlistPath, 'utf8')) as {
      allowlist: string[]
    }
    expect(Array.isArray(doc.allowlist)).toBe(true)
    expect(doc.allowlist.length).toBeGreaterThan(0)
    expect(doc.allowlist).toEqual([...doc.allowlist].sort())
    expect(new Set(doc.allowlist).size).toBe(doc.allowlist.length)
    for (const entry of doc.allowlist) {
      expect(entry).toMatch(/^packages\/[^/]+\/[^/]+\/tests\//)
      expect(entry.includes('\\')).toBe(false)
    }
  })
})
