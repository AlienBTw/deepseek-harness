import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@maple/cordis'
import LlmRuntime from '@maple/llm'
import * as LlmPiAi from '@maple/llm-pi-ai'
import { catalogModels, catalogProvider, catalogProviderIds } from '../src/catalog.ts'
import { discoverModels } from '../src/discovery.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

interface ProbeServer {
  url: string
  requests: { method: string; url: string }[]
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += String(chunk) })
    req.on('end', () => { resolve(body) })
  })
}

type ProbeHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void | Promise<void>

/**
 * A local HTTP server recording every request; the handler answers with a
 * JSON body (or status) per path. Requests are recorded before handling so a
 * failing assertion can still show what was asked for.
 */
async function createProbeServer(handler: ProbeHandler): Promise<ProbeServer> {
  const requests: { method: string; url: string }[] = []
  const server = createServer((req, res) => {
    void readBody(req).then(async (body) => {
      requests.push({ method: req.method ?? '', url: req.url ?? '' })
      await handler(req, res, body)
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  const address = server.address()
  if (typeof address === 'object' && address !== null) {
    return { url: `http://127.0.0.1:${String(address.port)}`, requests }
  }
  throw new Error('Server address missing')
}

/** Answer one JSON reply on the recorded request's response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  if (status >= 400) {
    res.writeHead(status)
    res.end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) })
  res.end(text)
}

describe('Ollama catalog and discovery', () => {
  it('registers ollama as a known catalog provider with bootstrap entries', () => {
    const ids = catalogProviderIds()
    expect(ids).toContain('ollama')

    const provider = catalogProvider('ollama')
    expect(provider).toBeDefined()
    expect(provider?.name).toBe('Ollama')

    // Bootstrap entries carry identity only: capacities are facts of what the
    // running server serves and arrive through discovery, never constants.
    const models = catalogModels('ollama')
    expect(models.size).toBeGreaterThan(0)
    expect(models.has('llama3.2')).toBe(true)
    expect(models.has('qwen2.5-coder')).toBe(true)
  })

  it('discovers models from an OpenAI-compatible /v1/models endpoint without API key', async () => {
    const server = await createProbeServer((req, res) => {
      if (req.url === '/v1/models') {
        json(res, 200, {
          object: 'list',
          data: [
            { id: 'llama3.2:latest', object: 'model' },
            { id: 'qwen2.5-coder:32b', object: 'model' },
            { id: 'deepseek-r1:14b', object: 'model' },
          ],
        })
      } else {
        json(res, 404, null)
      }
    })

    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {})

    const discovered = await ctx.llm.discoverModels('llm-pi-ai', {
      provider: 'ollama',
      baseURL: `${server.url}/v1`,
    })

    expect(discovered.map(m => m.id)).toEqual([
      'llama3.2:latest',
      'qwen2.5-coder:32b',
      'deepseek-r1:14b',
    ])
    // The OpenAI-compatible listing answered on the first probe; the native
    // tags endpoint must not have been touched.
    expect(server.requests.map(r => r.url)).toEqual(['/v1/models'])
  })

  it('enriches native /api/tags results with real context lengths from /api/show', async () => {
    const server = await createProbeServer((req, res, body) => {
      if (req.url === '/api/tags') {
        // Real /api/tags shape: family/quantization metadata only, no
        // capacity facts.
        json(res, 200, {
          models: [
            { name: 'mistral:latest', model: 'mistral:latest', details: { format: 'gguf', family: 'llama', parameter_size: '7.2B', quantization_level: 'Q4_0' } },
            { name: 'phi4:latest', model: 'phi4:latest', details: { format: 'gguf', family: 'phi3', parameter_size: '14.7B' } },
          ],
        })
        return
      }
      if (req.url === '/api/show' && req.method === 'POST') {
        const parsed = JSON.parse(body) as { model?: unknown }
        // The context length key is architecture-prefixed; the two models use
        // different families so the suffix match is what carries the value.
        json(res, 200, parsed.model === 'mistral:latest'
          ? { model_info: { 'general.architecture': 'llama', 'llama.context_length': 32768 } }
          : { model_info: { 'general.architecture': 'phi3', 'phi3.context_length': 16384 } })
        return
      }
      json(res, 404, null)
    })

    const discovered = await discoverModels({
      provider: 'ollama',
      baseURL: server.url,
    })

    expect(discovered).toEqual([
      { id: 'mistral:latest', contextWindow: 32768 },
      { id: 'phi4:latest', contextWindow: 16384 },
    ])
    // The two OpenAI-shaped probes miss before the native listing wins; each
    // discovered id then gets exactly one show call.
    expect(server.requests.map(r => r.url)).toEqual([
      '/models',
      '/v1/models',
      '/api/tags',
      '/api/show',
      '/api/show',
    ])
  })

  it('keeps the listing usable when every show call fails', async () => {
    const server = await createProbeServer((req, res) => {
      if (req.url === '/api/tags') {
        json(res, 200, { models: [{ name: 'mistral:latest' }, { name: 'phi4:latest' }] })
        return
      }
      // Only enrichment fails; the listing probes themselves must miss with
      // 404 so discovery reaches the native listing.
      if (req.url === '/api/show' && req.method === 'POST') {
        json(res, 500, null)
        return
      }
      json(res, 404, null)
    })

    const discovered = await discoverModels({
      provider: 'ollama',
      baseURL: server.url,
    })

    expect(discovered).toEqual([
      { id: 'mistral:latest' },
      { id: 'phi4:latest' },
    ])
  })

  it('never probes ollama-native endpoints for another provider', async () => {
    const server = await createProbeServer((req, res) => {
      if (req.url === '/v1/models') {
        json(res, 200, { object: 'list', data: [{ id: 'acme-large' }] })
        return
      }
      json(res, 404, null)
    })

    const discovered = await discoverModels({
      provider: 'acme-gateway',
      baseURL: server.url,
    })

    expect(discovered.map(m => m.id)).toEqual(['acme-large'])
    // The gateway speaks OpenAI-compatible only; its sibling paths stay
    // unrequested even though this server would have answered them.
    expect(server.requests.map(r => r.url)).toEqual(['/models', '/v1/models'])
  })
})
