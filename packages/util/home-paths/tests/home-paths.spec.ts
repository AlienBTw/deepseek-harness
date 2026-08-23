import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MAPLE_HOME_DISPLAY,
  MAPLE_HOME_DIR_NAME,
  canonicalizeWatchPath,
  defaultDshHome,
  dshHomeDisplay,
  mapleHomePath,
  expandHomePath,
  resolveMapleHome,
} from '@maple/home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('dsh path helpers', () => {
  it('owns the shared default DSH home directory name', () => {
    expect(MAPLE_HOME_DIR_NAME).toBe('.maple')
    expect(DEFAULT_MAPLE_HOME_DISPLAY).toBe('~/.maple')
    expect(defaultDshHome()).toBe(join(homedir(), '.maple'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.maple')).toBe(join(homedir(), '.maple'))
    expect(expandHomePath('~\\.dsh')).toBe(join(homedir(), '.maple'))
    expect(expandHomePath('/tmp/.dsh')).toBe('/tmp/.dsh')
    expect(expandHomePath('~other/.dsh')).toBe('~other/.dsh')
  })

  it('resolves explicit path before MAPLE_HOME and the default', () => {
    const envHome = join(homedir(), 'env-dsh')

    expect(resolveMapleHome('/tmp/explicit-dsh', { MAPLE_HOME: '~/env-dsh' })).toBe(resolve('/tmp/explicit-dsh'))
    expect(resolveMapleHome(undefined, { MAPLE_HOME: '~/env-dsh' })).toBe(envHome)
    expect(resolveMapleHome(undefined, {})).toBe(defaultDshHome())
  })

  it('treats an empty or whitespace-only MAPLE_HOME as unset', () => {
    expect(resolveMapleHome(undefined, { MAPLE_HOME: '' })).toBe(defaultDshHome())
    expect(resolveMapleHome(undefined, { MAPLE_HOME: '   ' })).toBe(defaultDshHome())
  })

  it('joins child segments onto the resolved MAPLE_HOME', () => {
    vi.stubEnv('MAPLE_HOME', '~/env-dsh')
    expect(mapleHomePath()).toBe(join(homedir(), 'env-dsh'))
    expect(mapleHomePath('storages', 'cache')).toBe(join(homedir(), 'env-dsh', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(dshHomeDisplay(resolve(defaultDshHome()))).toBe('~/.maple')
    expect(dshHomeDisplay('/some/other/root')).toBe('$MAPLE_HOME')
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
