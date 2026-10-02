import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryKeychainBackend,
  createOsKeychainBackend,
  isAbsentKeychainError,
  type OsKeychainEntry,
} from '../src/backend.ts'

describe('createMemoryKeychainBackend', () => {
  it('round-trips, treats empty as absent, and makes delete a no-op when missing', async () => {
    const store = createMemoryKeychainBackend()
    expect(await store.getPassword('a')).toBeUndefined()
    await store.setPassword('a', 'secret')
    expect(await store.getPassword('a')).toBe('secret')
    await store.setPassword('a', '')
    expect(await store.getPassword('a')).toBeUndefined()
    await store.deletePassword('missing')
    await store.setPassword('b', 'kept')
    await store.deletePassword('b')
    expect(await store.getPassword('b')).toBeUndefined()
  })
})

describe('isAbsentKeychainError', () => {
  it('recognizes common absence spellings and rejects other failures', () => {
    expect(isAbsentKeychainError(new Error('NoEntry'))).toBe(true)
    expect(isAbsentKeychainError(new Error('Password not found'))).toBe(true)
    expect(isAbsentKeychainError(new Error('could not be found'))).toBe(true)
    expect(isAbsentKeychainError(new Error('does not exist'))).toBe(true)
    expect(isAbsentKeychainError(new Error('Element not found'))).toBe(true)
    expect(isAbsentKeychainError(new Error('access denied'))).toBe(false)
    expect(isAbsentKeychainError('not found')).toBe(true)
  })
})

describe('createOsKeychainBackend', () => {
  it('reads, writes, and deletes through the injectable Entry factory', async () => {
    const accounts = new Map<string, string>()
    const createEntry = (service: string, account: string): OsKeychainEntry => ({
      getPassword() {
        expect(service).toBe('svc')
        return accounts.get(account) ?? null
      },
      setPassword(password) {
        accounts.set(account, password)
      },
      deletePassword() {
        if (!accounts.has(account)) throw new Error('not found')
        accounts.delete(account)
      },
    })
    const store = createOsKeychainBackend('svc', createEntry)
    expect(await store.getPassword('a')).toBeUndefined()
    await store.setPassword('a', 'secret')
    expect(await store.getPassword('a')).toBe('secret')
    await store.setPassword('a', '')
    expect(await store.getPassword('a')).toBeUndefined()
    await store.deletePassword('missing')
    await store.setPassword('b', 'x')
    await store.deletePassword('b')
    expect(await store.getPassword('b')).toBeUndefined()
  })

  it('treats a thrown NoEntry and an empty OS password as absent', async () => {
    const createEntry = (_service: string, account: string): OsKeychainEntry => ({
      getPassword() {
        if (account === 'empty') return ''
        throw new Error('NoEntry')
      },
      setPassword() {},
      deletePassword() {
        throw new Error('not found')
      },
    })
    const store = createOsKeychainBackend('svc', createEntry)
    expect(await store.getPassword('missing')).toBeUndefined()
    expect(await store.getPassword('empty')).toBeUndefined()
    await expect(store.deletePassword('missing')).resolves.toBeUndefined()
  })

  it('surfaces non-absence OS failures from get and delete', async () => {
    const createEntry = (): OsKeychainEntry => ({
      getPassword() {
        throw new Error('access denied')
      },
      setPassword() {
        throw new Error('write failed')
      },
      deletePassword() {
        throw new Error('access denied')
      },
    })
    const store = createOsKeychainBackend('svc', createEntry)
    await expect(store.getPassword('a')).rejects.toThrow(/access denied/)
    await expect(store.setPassword('a', 'x')).rejects.toThrow(/write failed/)
    await expect(store.deletePassword('a')).rejects.toThrow(/access denied/)
  })

  it('uses @napi-rs/keyring Entry when no factory is supplied', async () => {
    // The default factory constructs a real Entry; without a host keychain
    // entry the get path must still classify absence rather than throw through.
    const store = createOsKeychainBackend(`maple-harness-test-${String(process.pid)}`)
    // Absence on a fresh service/account is the success path for CI hosts.
    await expect(store.getPassword(`absent-${String(Date.now())}`)).resolves.toBeUndefined()
    await expect(store.deletePassword(`absent-${String(Date.now())}`)).resolves.toBeUndefined()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
