import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@maple/cordis'
import { credentialKey, credentialRef } from '@maple/credentials'
import type { CredentialKey, CredentialRecord } from '@maple/credentials'
import {
  createMemoryKeychainBackend,
  KeychainCredentialProvider,
  parseRecordIndex,
  parseStoredRecord,
  recordAccount,
  refAccount,
  type KeychainBackend,
} from '../src/index.ts'

const CODEX = credentialKey('llm-pi-ai', 'openai-codex')
const BEDROCK = credentialKey('llm-pi-ai', 'amazon-bedrock')
const REF = credentialRef('DEEPSEEK_API_KEY')

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function boot(
  config: ConstructorParameters<typeof KeychainCredentialProvider>[1] = { backend: 'memory' },
): Promise<Context> {
  const ctx = new Context()
  const fiber = ctx.plugin(KeychainCredentialProvider, config)
  cleanups.push(async () => { await fiber.dispose() })
  await fiber
  return ctx
}

function put(ctx: Context, key: CredentialKey, record: CredentialRecord): Promise<CredentialRecord | undefined> {
  return ctx.credentials.modifyRecord(key, () => Promise.resolve(record))
}

function recordUpdates(ctx: Context): CredentialKey[] {
  const seen: CredentialKey[] = []
  ctx.on('credentials/record-updated', (key) => { seen.push(key) })
  return seen
}

describe('account helpers and parsers', () => {
  it('names ref and record accounts distinctly', () => {
    expect(refAccount(REF)).toBe('DEEPSEEK_API_KEY')
    expect(recordAccount(CODEX)).toBe('#record/llm-pi-ai/openai-codex')
  })

  it('parses an empty or missing index as no records', () => {
    expect(parseRecordIndex(undefined)).toEqual([])
    expect(parseRecordIndex('')).toEqual([])
    expect(parseRecordIndex(JSON.stringify(['llm-pi-ai/openai-codex']))).toEqual([CODEX])
  })

  it('rejects a corrupt record index', () => {
    expect(() => parseRecordIndex('{')).toThrow(/not valid JSON/)
    expect(() => parseRecordIndex('{}')).toThrow(/JSON array/)
    expect(() => parseRecordIndex('[1]')).toThrow(/must be a string/)
    expect(() => parseRecordIndex('["bad"]')).toThrow(/must be "<scope>\/<id>"/)
  })

  it('admits grant and api-key records and rejects corrupt payloads', () => {
    expect(parseStoredRecord(CODEX, JSON.stringify({ kind: 'grant', payload: { t: 1 } }))).toEqual({
      kind: 'grant',
      payload: { t: 1 },
    })
    expect(parseStoredRecord(CODEX, JSON.stringify({ kind: 'grant', payload: [true, false, 1] }))).toEqual({
      kind: 'grant',
      payload: [true, false, 1],
    })
    expect(parseStoredRecord(BEDROCK, JSON.stringify({ kind: 'api-key', key: 'sk' }))).toEqual({
      kind: 'api-key',
      key: 'sk',
    })
    expect(parseStoredRecord(BEDROCK, JSON.stringify({ kind: 'api-key', env: { AWS_PROFILE: 'prod' } }))).toEqual({
      kind: 'api-key',
      env: { AWS_PROFILE: 'prod' },
    })
    expect(parseStoredRecord(BEDROCK, JSON.stringify({ kind: 'api-key' }))).toEqual({ kind: 'api-key' })
    expect(() => parseStoredRecord(CODEX, '{')).toThrow(/not valid JSON/)
    expect(() => parseStoredRecord(CODEX, '[]')).toThrow(/JSON object/)
    expect(() => parseStoredRecord(CODEX, JSON.stringify({ kind: 'grant' }))).toThrow(/no payload/)
    expect(() => parseStoredRecord(CODEX, JSON.stringify({ kind: 'api-key', key: '' }))).toThrow(/empty key/)
    expect(() => parseStoredRecord(CODEX, JSON.stringify({ kind: 'api-key', extra: 1 }))).toThrow(/unknown field/)
    expect(() => parseStoredRecord(CODEX, JSON.stringify({ kind: 'api-key', env: 'x' }))).toThrow(/non-mapping env/)
    expect(() => parseStoredRecord(CODEX, JSON.stringify({ kind: 'api-key', env: { BAD: '' } }))).toThrow(/non-empty string/)
    expect(() => parseStoredRecord(CODEX, JSON.stringify({ kind: 'api-key', env: { 'bad-name!': 'x' } }))).toThrow()
    expect(() => parseStoredRecord(CODEX, JSON.stringify({}))).toThrow(/no kind/)
    expect(() => parseStoredRecord(CODEX, JSON.stringify({ kind: 'other' }))).toThrow(/unknown kind/)
    // JSON.parse can produce non-finite numbers from large exponents.
    expect(() => parseStoredRecord(CODEX, '{"kind":"grant","payload":1e999}')).toThrow(/non-finite/)
  })
})

describe('record storage', () => {
  it('returns a grant payload exactly as its owner wrote it', async () => {
    const ctx = await boot()
    const payload = { type: 'oauth', access: 'a', refresh: 'r', expires: 1 }
    await put(ctx, CODEX, { kind: 'grant', payload })
    expect(await ctx.credentials.readRecord(CODEX)).toEqual({ kind: 'grant', payload })
    expect(await ctx.credentials.describeRecord(CODEX)).toEqual({
      configured: true,
      kind: 'grant',
      writable: true,
    })
    expect(await ctx.credentials.listRecords()).toEqual([{ key: CODEX, kind: 'grant' }])
  })

  it('stores ambient api-key records and lists every indexed key', async () => {
    const ctx = await boot()
    const seen = recordUpdates(ctx)
    await put(ctx, BEDROCK, { kind: 'api-key' })
    await put(ctx, CODEX, { kind: 'api-key', key: 'sk', env: { AWS_PROFILE: 'prod' } })
    expect(await ctx.credentials.listRecords()).toEqual([
      { key: BEDROCK, kind: 'api-key' },
      { key: CODEX, kind: 'api-key' },
    ])
    expect(seen).toEqual([BEDROCK, CODEX])
    await put(ctx, CODEX, { kind: 'api-key', key: 'sk2' })
    expect((await ctx.credentials.listRecords()).filter(e => e.key === CODEX)).toHaveLength(1)
  })

  it('leaves the record untouched when mutate declines', async () => {
    const ctx = await boot()
    await put(ctx, CODEX, { kind: 'grant', payload: { a: 1 } })
    const seen = recordUpdates(ctx)
    const result = await ctx.credentials.modifyRecord(CODEX, () => Promise.resolve(undefined))
    expect(result).toEqual({ kind: 'grant', payload: { a: 1 } })
    expect(seen).toEqual([])
  })

  it('deletes a record, heals a stale index, and no-ops an absent delete', async () => {
    const store = createMemoryKeychainBackend()
    const ctx = await boot({ backend: 'memory', store })
    await put(ctx, CODEX, { kind: 'grant', payload: { a: 1 } })
    await put(ctx, BEDROCK, { kind: 'api-key', key: 'k' })
    const seen = recordUpdates(ctx)
    await ctx.credentials.deleteRecord(CODEX)
    expect(await ctx.credentials.readRecord(CODEX)).toBeUndefined()
    expect(await ctx.credentials.listRecords()).toEqual([{ key: BEDROCK, kind: 'api-key' }])
    expect(seen).toEqual([CODEX])

    await store.setPassword('#index/records', JSON.stringify([CODEX, BEDROCK]))
    await ctx.credentials.deleteRecord(CODEX)
    expect(await ctx.credentials.listRecords()).toEqual([{ key: BEDROCK, kind: 'api-key' }])

    await ctx.credentials.deleteRecord(BEDROCK)
    expect(await ctx.credentials.listRecords()).toEqual([])
    await ctx.credentials.deleteRecord(BEDROCK)
  })

  it('skips indexed keys whose accounts vanished when listing', async () => {
    const store = createMemoryKeychainBackend()
    const ctx = await boot({ backend: 'memory', store })
    await put(ctx, CODEX, { kind: 'grant', payload: { a: 1 } })
    await store.deletePassword(recordAccount(CODEX))
    expect(await ctx.credentials.listRecords()).toEqual([])
  })

  it('refuses unstorable mutate results', async () => {
    const ctx = await boot()
    await expect(put(ctx, CODEX, { kind: 'api-key', key: '' })).rejects.toThrow(/empty key/)
    await expect(put(ctx, CODEX, { kind: 'api-key', env: { X: '' } })).rejects.toThrow(/non-empty string/)
    await expect(put(ctx, CODEX, {
      kind: 'grant',
      payload: { boom: Number.POSITIVE_INFINITY },
    })).rejects.toThrow(/non-finite/)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    await expect(put(ctx, CODEX, { kind: 'grant', payload: cyclic })).rejects.toThrow(/cyclic/)
    await expect(put(ctx, CODEX, { kind: 'grant', payload: 1n as unknown as object })).rejects.toThrow(/JSON cannot represent/)
    await expect(put(ctx, CODEX, { kind: 'grant', payload: new Date() })).rejects.toThrow(/JSON cannot represent/)
  })

  it('refuses record writes after dispose, including queued ones', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let getCount = 0
    const store: KeychainBackend = {
      async getPassword() {
        getCount += 1
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

    const first = service.modifyRecord(CODEX, () => Promise.resolve({ kind: 'grant', payload: { v: 1 } }))
    await new Promise(resolvePause => setTimeout(resolvePause, 5))
    const queuedModify = expect(service.modifyRecord(BEDROCK, () => Promise.resolve({ kind: 'api-key' })))
      .rejects.toThrow(/disposed before the queued/)
    const queuedDelete = expect(service.deleteRecord(BEDROCK)).rejects.toThrow(/disposed before the queued/)
    const disposal = fiber.dispose()
    await new Promise(resolvePause => setTimeout(resolvePause, 10))
    release()
    await disposal

    await expect(first).resolves.toEqual({ kind: 'grant', payload: { v: 1 } })
    await queuedModify
    await queuedDelete
    await expect(service.modifyRecord(CODEX, () => Promise.resolve({ kind: 'api-key' }))).rejects.toThrow(/disposed/)
    await expect(service.deleteRecord(CODEX)).rejects.toThrow(/disposed/)
  })

  it('reports an absent record as unconfigured and writable', async () => {
    const ctx = await boot()
    expect(await ctx.credentials.describeRecord(CODEX)).toEqual({ configured: false, writable: true })
  })
})
