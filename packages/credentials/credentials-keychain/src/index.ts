/**
 * OS-keychain credentials provider: secrets live in the host keychain (macOS
 * Keychain, Windows Credential Manager, or Linux Secret Service) rather than
 * in a file the model's same-UID tools can read. Resolution still layers the
 * inherited process environment over the keychain store, with the launcher's
 * project and user `.env` layers as fallbacks — swapping this provider for
 * `@maple/credentials-local` does not change environment semantics.
 *
 * ```text
 * inherited process environment      (read-only, wins)
 * > OS keychain (service = Config.service)  (provider-managed, writable)
 * > <invocation cwd>/.env            (read-only fallback)
 * > $MAPLE_HOME/.env                   (read-only fallback)
 * ```
 *
 * Config selects the storage backend: `os` talks to the real keychain through
 * `@napi-rs/keyring`; `memory` is an in-process Map for tests and CI. Suites
 * may also inject a custom {@link KeychainBackend} without touching either.
 * @module @maple/credentials-keychain
 */

import { Context, Service } from '@maple/cordis'
import z from '@maple/schemastery'
import { launchEnvironmentOf } from '@maple/launch-environment'
import {
  CredentialProvider,
  credentialRef,
  parseCredentialKey,
} from '@maple/credentials'
import type {
  ApiKeyRecord,
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@maple/credentials'
import type { LaunchEnvironmentEntry } from '@maple/launch-environment'
import {
  createMemoryKeychainBackend,
  createOsKeychainBackend,
  type KeychainBackend,
} from './backend.ts'

export type {
  KeychainBackend,
  OsKeychainEntry,
  OsKeychainEntryFactory,
} from './backend.ts'
export {
  createMemoryKeychainBackend,
  createOsKeychainBackend,
  isAbsentKeychainError,
} from './backend.ts'

/** Default keychain service name when Config omits `service`. */
export const DEFAULT_SERVICE = 'maple-harness'

/** Account holding the JSON array of stored {@link CredentialKey} values. */
const RECORD_INDEX_ACCOUNT = '#index/records'

/** Prefix for every stored record account (`#record/<scope>/<id>`). */
const RECORD_ACCOUNT_PREFIX = '#record/'

/** Source id the provider reports for keychain-backed reference values. */
export const KEYCHAIN_SOURCE = 'keychain'

/** Which store Config mounts under the configured service name. */
export type KeychainBackendKind = 'os' | 'memory'

/** Plugin config: service name and which backend owns the secrets. */
export interface Config {
  /** Keychain service name; defaults to {@link DEFAULT_SERVICE}. */
  service?: string
  /**
   * Storage backend. `os` uses the host keychain via `@napi-rs/keyring`;
   * `memory` is an in-process Map for tests and CI. Defaults to `os`.
   */
  backend?: KeychainBackendKind
  /**
   * Injectable store for tests. Not part of the Schemastery schema (YAML
   * compositions cannot set it); a programmatic `ctx.plugin` config keeps the
   * field through non-strict merge and replaces {@link backend} entirely.
   */
  store?: KeychainBackend
}

/** Fully resolved provider parameters; defaulting happens here, never inline. */
export interface ResolvedSpec {
  service: string
  backend: KeychainBackendKind
}

/**
 * Resolve the runtime spec from plugin config.
 * @param config - raw plugin config.
 * @returns the resolved service name and backend kind.
 */
export function resolveSpec(config: Config): ResolvedSpec {
  return {
    service: config.service ?? DEFAULT_SERVICE,
    backend: config.backend ?? 'os',
  }
}

/**
 * Account name for one reference under the configured service.
 * @param ref - the credential reference.
 * @returns the keychain account.
 */
export function refAccount(ref: CredentialRef): string {
  return ref
}

/**
 * Account name for one record under the configured service.
 * @param key - the credential key.
 * @returns the keychain account.
 */
export function recordAccount(key: CredentialKey): string {
  return `${RECORD_ACCOUNT_PREFIX}${key}`
}

/**
 * Pick the Config-selected backend, or an injected {@link Config.store}.
 * @param config - plugin config (may carry a programmatic store).
 * @param spec - resolved service and backend kind.
 * @returns the store the provider will use.
 */
export function resolveBackend(config: Config, spec: ResolvedSpec): KeychainBackend {
  if (config.store !== undefined) return config.store
  if (spec.backend === 'memory') return createMemoryKeychainBackend()
  return createOsKeychainBackend(spec.service)
}

/**
 * Refuse an api-key record the read path could not admit, before it is
 * stored: an empty key, an env name outside the reference grammar, or an
 * empty env value would persist a payload `parseStoredRecord` rejects.
 * @param key - the record's credential key, for the failure message.
 * @param record - the api-key record a mutation returned.
 */
function assertStorableApiKey(key: CredentialKey, record: ApiKeyRecord): void {
  if (record.key !== undefined && record.key.length === 0) {
    throw new TypeError(`credentials-keychain: record "${key}" has an empty key; omit the field instead`)
  }
  for (const [name, value] of Object.entries(record.env ?? {})) {
    credentialRef(name)
    if (value.length === 0) {
      throw new TypeError(`credentials-keychain: record "${key}" env "${name}" must be a non-empty string`)
    }
  }
}

/**
 * Reject a payload that cannot survive a JSON round trip. Neither the value
 * nor any nested value is quoted in a diagnostic.
 * @param where - the subject named in a diagnostic, already free of any value.
 * @param value - the payload or nested value to admit.
 * @param seen - objects on the current path, for cycle detection.
 */
function assertJsonValue(where: string, value: unknown, seen: Set<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw new TypeError(`credentials-keychain: ${where} holds a non-finite number`)
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new TypeError(`credentials-keychain: ${where} is cyclic`)
    if (Object.getPrototypeOf(value) === Object.prototype || Array.isArray(value)) {
      seen.add(value)
      for (const nested of Object.values(value)) assertJsonValue(where, nested, seen)
      seen.delete(value)
      return
    }
  }
  throw new TypeError(`credentials-keychain: ${where} holds a value JSON cannot represent`)
}

/**
 * Admit one stored record JSON payload. Unknown tags and fields fail loud —
 * a silently ignored field would read as "the credential I stored has no effect".
 * @param key - the record's address, for diagnostics.
 * @param text - the keychain password holding the JSON.
 * @returns the admitted record.
 */
export function parseStoredRecord(key: CredentialKey, text: string): CredentialRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error(`credentials-keychain: record "${key}" is not valid JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`credentials-keychain: record "${key}" must be a JSON object`)
  }
  const fields = parsed as Record<string, unknown>
  const kind = fields['kind']
  if (kind === 'api-key') {
    assertFields(key, fields, ['kind', 'key', 'env'])
    const apiKey = fields['key']
    if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length === 0)) {
      throw new TypeError(`credentials-keychain: record "${key}" has a non-string or empty key`)
    }
    const env = parseRecordEnv(key, fields['env'])
    return {
      kind: 'api-key',
      ...apiKey === undefined ? {} : { key: apiKey },
      ...env === undefined ? {} : { env },
    }
  }
  if (kind === 'grant') {
    assertFields(key, fields, ['kind', 'payload'])
    if (!('payload' in fields)) {
      throw new Error(`credentials-keychain: record "${key}" has no payload`)
    }
    assertJsonValue(`record "${key}" payload`, fields['payload'], new Set())
    return { kind: 'grant', payload: fields['payload'] }
  }
  if (kind === undefined) throw new Error(`credentials-keychain: record "${key}" has no kind`)
  throw new Error(`credentials-keychain: record "${key}" has unknown kind ${JSON.stringify(kind)}`)
}

/** Reject a field the tag does not define, so a typo is not silently dropped. */
function assertFields(key: CredentialKey, fields: Record<string, unknown>, allowed: string[]): void {
  for (const field of Object.keys(fields)) {
    if (!allowed.includes(field)) {
      throw new Error(`credentials-keychain: record "${key}" has unknown field "${field}"`)
    }
  }
}

/** Admit an api-key record's provider environment: POSIX names over non-empty strings. */
function parseRecordEnv(key: CredentialKey, env: unknown): Record<string, string> | undefined {
  if (env === undefined) return undefined
  if (typeof env !== 'object' || env === null || Array.isArray(env)) {
    throw new TypeError(`credentials-keychain: record "${key}" has a non-mapping env`)
  }
  const parsed: Record<string, string> = {}
  for (const [name, value] of Object.entries(env as Record<string, unknown>)) {
    credentialRef(name)
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(
        `credentials-keychain: record "${key}" env "${name}" must be a non-empty string`,
      )
    }
    parsed[name] = value
  }
  return parsed
}

/**
 * Admit the record-index JSON. A missing or empty index is an empty list; any
 * other shape fails loud so a corrupted index never silently drops records.
 * @param text - the index password, or `undefined` while absent.
 * @returns every stored credential key.
 */
export function parseRecordIndex(text: string | undefined): CredentialKey[] {
  if (text === undefined || text.length === 0) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error('credentials-keychain: record index is not valid JSON')
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError('credentials-keychain: record index must be a JSON array')
  }
  return parsed.map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new TypeError(`credentials-keychain: record index entry ${String(index)} must be a string`)
    }
    return parseCredentialKey(entry)
  })
}

/** OS-keychain credentials provider. */
export class KeychainCredentialProvider extends CredentialProvider {
  static Config: z<Config> = z.object({
    service: z.string().default(DEFAULT_SERVICE),
    backend: z.union(['os', 'memory'] as const).default('os'),
  })

  private readonly spec: ResolvedSpec
  private readonly store: KeychainBackend
  /**
   * Single exclusive operation chain: reference and record writes run one at
   * a time in arrival order so a modifyRecord cannot interleave with a concurrent
   * set under the same process.
   */
  private operations: Promise<void> = Promise.resolve()
  /** Set at dispose: refuse new writes and let in-flight work no-op. */
  private closed = false

  /** Opaque read of {@link closed}: control flow cannot narrow it across awaits. */
  private isClosed(): boolean {
    return this.closed
  }

  /**
   * @param ctx - Cordis context.
   * @param config - plugin config (service, backend kind, optional injectable store).
   */
  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.spec = resolveSpec(config)
    this.store = resolveBackend(config, this.spec)
  }

  /** The inherited-environment value for a reference, or `undefined` when empty or unset. */
  private inherited(ref: CredentialRef): string | undefined {
    const entry = launchEnvironmentOf(this.ctx).getFrom(ref, ['process'])
    return entry !== undefined && entry.value.length > 0 ? entry.value : undefined
  }

  /**
   * The `.env` fallback for a reference — below the keychain store, never above
   * it. The invoking project ranks over the user's home file.
   */
  private dotenvFallback(ref: CredentialRef): LaunchEnvironmentEntry | undefined {
    const entry = launchEnvironmentOf(this.ctx).getFrom(ref, ['project-env', 'user-env'])
    return entry !== undefined && entry.value.length > 0 ? entry : undefined
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    yield async () => {
      this.closed = true
      await this.operations
    }
  }

  override async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const inherited = this.inherited(ref)
    if (inherited !== undefined) return { value: inherited, source: 'env' }
    const stored = await this.store.getPassword(refAccount(ref))
    if (stored !== undefined) return { value: stored, source: KEYCHAIN_SOURCE }
    const fallback = this.dotenvFallback(ref)
    if (fallback !== undefined) return { value: fallback.value, source: fallback.source }
    return undefined
  }

  override async describe(ref: CredentialRef): Promise<CredentialInfo> {
    if (this.inherited(ref) !== undefined) {
      return { configured: true, source: 'env', writable: false }
    }
    const stored = await this.store.getPassword(refAccount(ref))
    if (stored !== undefined) return { configured: true, source: KEYCHAIN_SOURCE, writable: true }
    const fallback = this.dotenvFallback(ref)
    if (fallback !== undefined) return { configured: true, source: fallback.source, writable: true }
    return { configured: false, writable: true }
  }

  override async set(ref: CredentialRef, value: string): Promise<void> {
    if (value.length === 0) {
      throw new Error(`credentials-keychain: an empty value cannot be stored for "${ref}"; use unset`)
    }
    await this.writeRef(ref, value)
  }

  override async unset(ref: CredentialRef): Promise<void> {
    await this.writeRef(ref, undefined)
  }

  override async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    const text = await this.store.getPassword(recordAccount(key))
    if (text === undefined) return undefined
    return parseStoredRecord(key, text)
  }

  override async describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const stored = await this.readRecord(key)
    if (stored === undefined) return { configured: false, writable: true }
    return { configured: true, kind: stored.kind, writable: true }
  }

  override async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    const keys = parseRecordIndex(await this.store.getPassword(RECORD_INDEX_ACCOUNT))
    const entries: CredentialRecordEntry[] = []
    for (const key of keys) {
      const record = await this.readRecord(key)
      if (record === undefined) continue
      entries.push({ key, kind: record.kind })
    }
    return entries
  }

  override async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    if (this.isClosed()) throw new Error(`credentials-keychain is disposed: cannot modify "${key}"`)
    return this.enqueue(async () => {
      if (this.isClosed()) {
        throw new Error(`credentials-keychain was disposed before the queued "${key}" modify ran`)
      }
      const currentText = await this.store.getPassword(recordAccount(key))
      const current = currentText === undefined ? undefined : parseStoredRecord(key, currentText)
      const next = await mutate(current)
      if (next === undefined) return current
      if (next.kind === 'grant') assertJsonValue(`record "${key}" payload`, next.payload, new Set())
      else assertStorableApiKey(key, next)
      await this.store.setPassword(recordAccount(key), JSON.stringify(next))
      await this.ensureRecordIndexed(key)
      this.notifyRecordUpdated(key)
      return next
    })
  }

  override async deleteRecord(key: CredentialKey): Promise<void> {
    if (this.isClosed()) throw new Error(`credentials-keychain is disposed: cannot delete "${key}"`)
    await this.enqueue(async () => {
      if (this.isClosed()) {
        throw new Error(`credentials-keychain was disposed before the queued "${key}" delete ran`)
      }
      const existing = await this.store.getPassword(recordAccount(key))
      if (existing === undefined) {
        // Heal a stale index entry left by an external delete.
        await this.dropRecordFromIndex(key)
        return
      }
      await this.store.deletePassword(recordAccount(key))
      await this.dropRecordFromIndex(key)
      this.notifyRecordUpdated(key)
    })
  }

  /** Queue one exclusive store operation behind every earlier one. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.operations.then(operation)
    this.operations = task.then(() => undefined, () => undefined)
    return task
  }

  /** Queue one reference write; entry checks reject early, the queue re-judges them at run time. */
  private async writeRef(ref: CredentialRef, value: string | undefined): Promise<void> {
    const verb = value === undefined ? 'unset' : 'set'
    if (this.isClosed()) {
      throw new Error(`credentials-keychain is disposed: cannot ${verb} "${ref}"`)
    }
    this.assertUnshadowed(ref, verb)
    return this.enqueue(async () => {
      if (this.isClosed()) {
        throw new Error(`credentials-keychain was disposed before the queued "${ref}" ${verb} ran`)
      }
      this.assertUnshadowed(ref, verb)
      const account = refAccount(ref)
      const existing = await this.store.getPassword(account)
      if (value === undefined) {
        if (existing === undefined) return
        await this.store.deletePassword(account)
      } else {
        await this.store.setPassword(account, value)
      }
      this.notifyUpdated(ref)
    })
  }

  /**
   * Reject a write the inherited environment would shadow into apparent
   * no-effect.
   */
  private assertUnshadowed(ref: CredentialRef, verb: 'set' | 'unset'): void {
    if (this.inherited(ref) !== undefined) {
      throw new Error(
        `credentials-keychain: "${ref}" is supplied read-only by the launching environment, so ${verb} would be`
        + ' shadowed; unset it in the shell you start dsh from instead',
      )
    }
  }

  /** Ensure `key` appears in the durable record index. */
  private async ensureRecordIndexed(key: CredentialKey): Promise<void> {
    const keys = parseRecordIndex(await this.store.getPassword(RECORD_INDEX_ACCOUNT))
    if (keys.includes(key)) return
    keys.push(key)
    await this.store.setPassword(RECORD_INDEX_ACCOUNT, JSON.stringify(keys))
  }

  /** Remove `key` from the durable record index when present. */
  private async dropRecordFromIndex(key: CredentialKey): Promise<void> {
    const keys = parseRecordIndex(await this.store.getPassword(RECORD_INDEX_ACCOUNT))
    const next = keys.filter(entry => entry !== key)
    if (next.length === keys.length) return
    if (next.length === 0) {
      await this.store.deletePassword(RECORD_INDEX_ACCOUNT)
      return
    }
    await this.store.setPassword(RECORD_INDEX_ACCOUNT, JSON.stringify(next))
  }
}

export default KeychainCredentialProvider
