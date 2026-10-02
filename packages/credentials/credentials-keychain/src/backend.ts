/**
 * Injectable keychain store boundary for `@maple/credentials-keychain`.
 * The provider never talks to the OS directly: Config picks `os` or `memory`,
 * and tests inject a custom {@link KeychainBackend} without touching a real
 * keychain.
 * @module @maple/credentials-keychain/backend
 */

import { Entry } from '@napi-rs/keyring'

/**
 * The password / secret operations the provider needs from one keychain
 * service. Account names are provider-owned; the backend never interprets
 * them. Absence is `undefined`, never an empty string.
 */
export interface KeychainBackend {
  /**
   * Read one account's secret.
   * @param account - provider-owned account name under the configured service.
   * @returns the non-empty secret, or `undefined` while absent.
   */
  getPassword(account: string): Promise<string | undefined>

  /**
   * Create or replace one account's secret.
   * @param account - provider-owned account name.
   * @param password - the non-empty secret to store.
   */
  setPassword(account: string, password: string): Promise<void>

  /**
   * Remove one account; removing an absent account is a no-op.
   * @param account - provider-owned account name.
   */
  deletePassword(account: string): Promise<void>
}

/**
 * The Entry surface {@link createOsKeychainBackend} needs — injectable so the
 * OS adapter is unit-tested without a real keychain.
 */
export interface OsKeychainEntry {
  /**
   * Read the stored password.
   * @returns the password string, or `null` when the account is absent.
   * @throws when the OS rejects the read for a reason other than absence.
   */
  getPassword(): string | null

  /**
   * Create or replace the stored password.
   * @param password - the secret to store.
   */
  setPassword(password: string): void

  /** Remove the stored password; may throw when already absent. */
  deletePassword(): void
}

/**
 * Build one {@link OsKeychainEntry} for a service/account pair.
 * @param service - keychain service name.
 * @param account - account name under that service.
 * @returns the entry handle.
 */
export type OsKeychainEntryFactory = (service: string, account: string) => OsKeychainEntry

/**
 * In-process keychain substitute for tests and CI. Secrets live only in this
 * Map for the life of the backend instance.
 * @returns a fresh empty backend.
 */
export function createMemoryKeychainBackend(): KeychainBackend {
  const store = new Map<string, string>()
  return {
    getPassword(account) {
      const value = store.get(account)
      return Promise.resolve(value === undefined || value.length === 0 ? undefined : value)
    },
    setPassword(account, password) {
      store.set(account, password)
      return Promise.resolve()
    },
    deletePassword(account) {
      store.delete(account)
      return Promise.resolve()
    },
  }
}

/**
 * Whether an OS entry error means the account is simply absent rather than a
 * hard failure. `@napi-rs/keyring` / keyring-rs spell absence as a thrown
 * error whose message names NoEntry / not found; anything else must surface.
 * @param error - the caught OS failure.
 * @returns true when the account should read as unset.
 */
export function isAbsentKeychainError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /no.?entry|not found|could not be found|does not exist|element not found/i.test(message)
}

/**
 * Real OS keychain backend over `@napi-rs/keyring` (macOS Keychain, Windows
 * Credential Manager, Linux Secret Service / keyutils). The entry factory is
 * injectable so suites pin behavior without opening a host keychain.
 * @param service - keychain service name shared by every account this provider owns.
 * @param createEntry - Entry constructor; defaults to `@napi-rs/keyring`'s `Entry`.
 * @returns the OS-backed {@link KeychainBackend}.
 */
export function createOsKeychainBackend(
  service: string,
  createEntry: OsKeychainEntryFactory = (svc, account) => new Entry(svc, account),
): KeychainBackend {
  return {
    async getPassword(account) {
      try {
        const password = createEntry(service, account).getPassword()
        // `@napi-rs/keyring` returns null when the account is absent on some
        // platforms; other platforms throw. Empty strings are seam-absent.
        if (password == null || password.length === 0) return undefined
        return password
      } catch (error) {
        if (isAbsentKeychainError(error)) return undefined
        throw error
      }
    },
    async setPassword(account, password) {
      createEntry(service, account).setPassword(password)
    },
    async deletePassword(account) {
      try {
        createEntry(service, account).deletePassword()
      } catch (error) {
        // Absence is a successful unset; every other OS failure must surface.
        if (isAbsentKeychainError(error)) return
        throw error
      }
    },
  }
}
