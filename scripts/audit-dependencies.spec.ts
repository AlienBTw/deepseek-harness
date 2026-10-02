import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0, error: undefined, signal: null })),
}))

vi.mock('./pnpm-invocation.ts', () => ({
  pnpmInvocation: () => ({ command: process.execPath, args: ['pnpm-stub', 'audit', '--audit-level', 'high'] }),
}))

describe('audit-dependencies', () => {
  it('invokes pnpm audit at high severity and returns the exit code', async () => {
    const { spawnSync } = await import('node:child_process')
    const { runDependencyAudit } = await import('./audit-dependencies.ts')
    expect(runDependencyAudit('/repo', { npm_execpath: '/tools/pnpm.cjs' })).toBe(0)
    expect(spawnSync).toHaveBeenCalledWith(
      process.execPath,
      ['pnpm-stub', 'audit', '--audit-level', 'high'],
      expect.objectContaining({ cwd: '/repo', shell: false }),
    )
  })
})
