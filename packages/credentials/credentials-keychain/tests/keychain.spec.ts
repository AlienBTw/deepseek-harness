import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@maple/cordis'
import { credentialRef } from '@maple/credentials'
import { createLaunchEnvironmentSnapshot, MAPLE_LAUNCH_ENVIRONMENT_KEY } from '@maple/launch-environment'
import type { CredentialRef } from '@maple/credentials'
import {
  createMemoryKeychainBackend,
  KEYCHAIN_SOURCE,
  KeychainCredentialProvider,
  resolveBackend,
  resolveSpec,
  type KeychainBackend,
} from '../src/index.ts'

const KEY = credentialRef('MAPLE_CRED_TEST')
const OTHER = credentialRef('MAPLE_CRED_OTHER')

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.unstubAllEnvs()
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function boot(
  config: ConstructorParameters<typeof KeychainCredentialProvider>[1] = { backend: 'memory' },
): Promise<Context> {
  const ctx = new Context()
  const fiber = ctx.plugin(KeychainCredentialProvider, config)
  cleanups.push(async () => {
    await fiber.dispose()
  })
  await fiber
  return ctx
}

function updates(ctx: Context): CredentialRef[] {
  const seen: CredentialRef[] = []
  ctx.on('credentials/reference-updated', (ref) => {
    seen.push(ref)
  })
  return seen
}

describe('resolveSpec / resolveBackend', () => {
  it('defaults the service name and os backend', () => {
    expect(resolveSpec({})).toEqual({ service: 'maple-harness', backend: 'os' })
    expect(resolveSpec({ service: 'custom', backend: 'memory' })).toEqual({
      service: 'custom',
      backend: 'memory',
    })
  })

  it('selects memory, os, or an injected store', async () => {
    const memory = resolveBackend({ backend: 'memory' }, { service: 's', backend: 'memory' })
    await memory.setPassword('a', '1')
    expect(await memory.getPassword('a')).toBe('1')

    const injected = createMemoryKeychainBackend()
    expect(resolveBackend({ backend: 'os', store: injected }, { service: 's', backend: 'os' })).toBe(injected)

    const os = resolveBackend({ backend: 'os' }, {
      service: `maple-harness-resolve-${String(process.pid)}`,
      backend: 'os',
    })
    await expect(os.getPassword(`missing-${String(Date.now())}`)).resolves.toBeUndefined()
  })
})

describe('layering and reads', () => {
  it('treats an empty store as writable and unconfigured', async () => {
    const ctx = await boot()
    expect(await ctx.credentials.resolve(KEY)).toBeUndefined()
    expect(await ctx.credentials.describe(KEY)).toEqual({ configured: false, writable: true })
  })

  it('stores and resolves through the keychain source', async () => {
    const ctx = await boot()
    const seen = updates(ctx)
    await ctx.credentials.set(KEY, 'plain')
    await ctx.credentials.set(OTHER, 'with space')
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'plain', source: KEYCHAIN_SOURCE })
    expect(await ctx.credentials.resolve(OTHER)).toEqual({ value: 'with space', source: KEYCHAIN_SOURCE })
    expect(await ctx.credentials.describe(KEY)).toEqual({
      configured: true,
      source: KEYCHAIN_SOURCE,
      writable: true,
    })
    expect(seen).toEqual([KEY, OTHER])
  })

  it('lets a non-empty process environment win read-only over the keychain', async () => {
    const ctx = await boot()
    await ctx.credentials.set(KEY, 'from-keychain')
    vi.stubEnv('MAPLE_CRED_TEST', 'from-env')
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'from-env', source: 'env' })
    expect(await ctx.credentials.describe(KEY)).toEqual({ configured: true, source: 'env', writable: false })
    await expect(ctx.credentials.set(KEY, 'x')).rejects.toThrow(/shadowed/)
    await expect(ctx.credentials.unset(KEY)).rejects.toThrow(/shadowed/)
  })

  it('treats an empty environment value as absent, falling through to the keychain', async () => {
    const ctx = await boot()
    await ctx.credentials.set(KEY, 'stored')
    vi.stubEnv('MAPLE_CRED_TEST', '')
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'stored', source: KEYCHAIN_SOURCE })
    expect(await ctx.credentials.describe(KEY)).toEqual({
      configured: true,
      source: KEYCHAIN_SOURCE,
      writable: true,
    })
  })

  it('rejects an empty set and no-ops an absent unset', async () => {
    const ctx = await boot()
    const seen = updates(ctx)
    await expect(ctx.credentials.set(KEY, '')).rejects.toThrow(/empty value/)
    await ctx.credentials.unset(KEY)
    expect(seen).toEqual([])
  })

  it('unsets a stored reference and notifies once', async () => {
    const ctx = await boot()
    const seen = updates(ctx)
    await ctx.credentials.set(KEY, 'v')
    await ctx.credentials.unset(KEY)
    expect(await ctx.credentials.resolve(KEY)).toBeUndefined()
    expect(seen).toEqual([KEY, KEY])
  })
})

describe('layer ladder', () => {
  async function bootLayered(
    layers: Parameters<typeof createLaunchEnvironmentSnapshot>[0],
  ): Promise<Context> {
    const ctx = new Context()
    ctx.provide(MAPLE_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot(layers))
    const fiber = ctx.plugin(KeychainCredentialProvider, { backend: 'memory' })
    cleanups.push(async () => { await fiber.dispose() })
    await fiber
    return ctx
  }

  it('ranks project-env over user-env below the keychain store', async () => {
    const ctx = await bootLayered([
      { source: 'project-env', path: '/proj/.env', values: { MAPLE_CRED_TEST: 'project' } },
      { source: 'user-env', path: '/home/.env', values: { MAPLE_CRED_TEST: 'user' } },
    ])
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'project', source: 'project-env' })
    expect(await ctx.credentials.describe(KEY)).toEqual({
      configured: true,
      source: 'project-env',
      writable: true,
    })
    await ctx.credentials.set(KEY, 'stored')
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'stored', source: KEYCHAIN_SOURCE })
  })

  it('falls through to user-env when project-env is empty', async () => {
    const ctx = await bootLayered([
      { source: 'user-env', path: '/home/.env', values: { MAPLE_CRED_TEST: 'user' } },
    ])
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'user', source: 'user-env' })
    expect(await ctx.credentials.describe(KEY)).toEqual({
      configured: true,
      source: 'user-env',
      writable: true,
    })
  })
})

describe('dispose and injection', () => {
  it('accepts an injected store', async () => {
    const store = createMemoryKeychainBackend()
    const ctx = await boot({ backend: 'os', service: 'ignored', store })
    await ctx.credentials.set(KEY, 'via-inject')
    expect(await store.getPassword('MAPLE_CRED_TEST')).toBe('via-inject')
  })

  it('lets an in-flight write land and fails the queued one after disposal', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let getCount = 0
    const store: KeychainBackend = {
      async getPassword() {
        getCount += 1
        // First get (in-flight write) parks; later gets from the queued write
        // run after closed is set and must see the dispose check.
        if (getCount === 1) await gate
        return undefined
      },
      async setPassword() {},
      async deletePassword() {},
    }
    const ctx = new Context()
    const fiber = ctx.plugin(KeychainCredentialProvider, { backend: 'memory', store })
    await fiber
    const service = ctx.credentials

    const first = service.set(KEY, 'one')
    await new Promise(resolvePause => setTimeout(resolvePause, 5))
    const secondRejects = expect(service.set(OTHER, 'two')).rejects.toThrow(/disposed before the queued/)
    const disposal = fiber.dispose()
    await new Promise(resolvePause => setTimeout(resolvePause, 10))
    release()
    await disposal

    await expect(first).resolves.toBeUndefined()
    await secondRejects
    await expect(service.set(KEY, 'x')).rejects.toThrow(/disposed/)
    await expect(service.unset(KEY)).rejects.toThrow(/disposed/)
  })
})
