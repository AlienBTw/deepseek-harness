/**
 * Answering "which models can this provider serve?" for the configuration
 * surface's "fetch available models" action.
 *
 * A route the installed pi-ai catalog ships is answered **from that catalog**,
 * with no network call at all: pi-ai's registry is the authoritative list for
 * its own providers, and it carries the capacities a listing endpoint would
 * not disclose. Only a route the catalog does not describe — a gateway, a
 * self-hosted server — is interrogated over the wire.
 *
 * Neither path is a catalog refresh. Nothing here is stored: the request
 * carries a draft the user is still editing, and the reply is candidate
 * metadata the surface offers for adoption. `settings.yaml` remains the only
 * thing that decides what a route serves.
 *
 * OpenAI-compatible protocols are interrogated via `GET /models`; the local
 * Ollama provider is additionally interrogated via its native `GET /api/tags`
 * listing, with each model's real context window read from its own
 * `POST /api/show` reply so no capacity is ever invented here. Every other
 * protocol reports that it cannot be interrogated so the surface falls back to
 * hand-entry rather than guessing a response shape.
 *
 * @module dsh-llm-pi-ai/discovery
 */

import { INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey } from '@maple/llm'
import type { LlmDiscoveredModel, LlmModelDiscoveryRequest } from '@maple/llm'
import { attributionHeaders } from '@maple/llm'
import { catalogModels } from './catalog.ts'

/**
 * Protocols whose model listing this module can read: the two that speak
 * OpenAI's `GET /models` shape with bearer auth. Azure is absent despite its
 * OpenAI lineage — it authenticates with an `api-key` header and requires an
 * `api-version` query — and Codex authenticates through OAuth; guessing at
 * either would report an authentication failure as a provider with no models.
 * pi-ai's remaining protocols are absent for the same reason.
 */
const LISTABLE_PROTOCOLS: ReadonlySet<string> = new Set([
  'openai-completions',
  'openai-responses',
])

/**
 * Endpoint replies larger than this are refused. The endpoint is whatever URL
 * the user typed, so the ceiling holds on the bytes actually read rather than
 * on the length the server claims — the same two-stage shape `dsh-web-fetch`
 * uses for its own caller-supplied URLs, except that a truncated model listing
 * is not parseable, so overflow rejects instead of truncating.
 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/** One entry of an OpenAI-compatible `GET /models` reply. */
interface ListingEntry {
  id?: unknown
  /** Common gateway extensions; absent from the official listings. */
  name?: unknown
  display_name?: unknown
  context_window?: unknown
  context_length?: unknown
  max_tokens?: unknown
  max_output_tokens?: unknown
}

/** A positive integer field of a listing entry, or `undefined` when absent or unusable. */
function capacity(...candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) return candidate
  }
  return undefined
}

/** A non-empty string field of a listing entry, or `undefined`. */
function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/** Default Ollama endpoint, used when the Ollama provider has no explicit baseURL. */
const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1'

/** Suffix that identifies an OpenAI-compatible base URL. */
const V1_SUFFIX = '/v1'

/**
 * Join the endpoint base with the listing path candidates. Ollama-native
 * `/api/tags` is only probed for the local `ollama` provider.
 * @param baseURL - the endpoint base URL.
 * @param provider - the requested provider id, when known.
 * @returns the candidate listing URLs in probe order.
 */
function listingUrls(baseURL: string, provider?: string): string[] {
  const clean = baseURL.replace(/\/+$/, '')
  const urls: string[] = []
  const isOllama = provider === 'ollama'
  if (clean.endsWith(V1_SUFFIX)) {
    urls.push(`${clean}/models`)
    if (isOllama) {
      const prefix = clean.slice(0, -V1_SUFFIX.length)
      urls.push(`${prefix}/api/tags`)
    }
  } else {
    urls.push(`${clean}/models`)
    urls.push(`${clean}/v1/models`)
    if (isOllama) {
      urls.push(`${clean}/api/tags`)
    }
  }
  return [...new Set(urls)]
}

/**
 * Whether a `models` array looks like an Ollama-native `/api/tags` reply.
 * @param rawModels - the raw models array.
 * @returns `true` when the shape matches Ollama's tags listing.
 */
function looksLikeOllamaTags(rawModels: readonly unknown[]): boolean {
  return rawModels.some(raw => typeof raw === 'object' && raw !== null && ('details' in raw || 'digest' in raw || 'modified_at' in raw))
}

/**
 * Read a reply body, refusing one that outgrows the ceiling. A declared length
 * is checked first so an honest server is turned away without transferring
 * anything; the accumulated total is what actually enforces the bound, because
 * a server that under-declares (or streams) tells us nothing up front.
 */
async function readBounded(response: Response, url: string): Promise<string> {
  const oversized = (): LlmError =>
    new LlmError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, 'DISCOVERY_FAILED')
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw oversized()
  }
  /* v8 ignore next -- fetch always exposes a body stream on a 2xx Response; the null guard is defensive. */
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw oversized()
      chunks.push(value)
    }
  } finally {
    /* v8 ignore next 4 -- cancel() after a completed or abandoned read settles without rejecting; unobserved best-effort cleanup. */
    await reader.cancel().catch(() => {
      // Cancel after a drained read, or after this function walked away from
      // an oversized one, is cleanup; the reply is already decided either way.
    })
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/**
 * Read one OpenAI-compatible or Ollama-native listing reply. Entries without a usable id are
 * skipped rather than failing the whole interrogation: a single malformed row
 * should not deny the user the rest of a working endpoint's catalog.
 *
 * The Ollama-native branch extracts ids only: `/api/tags` carries family and
 * quantization metadata but no capacity facts, which arrive from
 * {@link enrichOllamaCapabilities} instead.
 * @param body - the parsed JSON body.
 * @param provider - the requested provider id, when known.
 * @returns the discovered models.
 */
function readListing(body: unknown, provider?: string): LlmDiscoveredModel[] {
  const data = (body as { data?: unknown } | null)?.data
  const rawModels = (body as { models?: unknown } | null)?.models

  if (Array.isArray(data)) {
    const models: LlmDiscoveredModel[] = []
    for (const raw of data) {
      const entry = raw as ListingEntry | null
      const id = label(entry?.id)
      if (id === undefined) continue
      const name = label(entry?.name, entry?.display_name)
      const contextWindow = capacity(entry?.context_window, entry?.context_length)
      const maxTokens = capacity(entry?.max_output_tokens, entry?.max_tokens)
      models.push({
        id,
        ...name === undefined ? {} : { name },
        ...contextWindow === undefined ? {} : { contextWindow },
        ...maxTokens === undefined ? {} : { maxTokens },
      })
    }
    return models
  }

  if (Array.isArray(rawModels) && (provider === 'ollama' || looksLikeOllamaTags(rawModels))) {
    const models: LlmDiscoveredModel[] = []
    for (const raw of rawModels) {
      const entry = raw as { name?: unknown; model?: unknown } | null
      const id = label(entry?.name, entry?.model)
      if (id === undefined) continue
      models.push({ id })
    }
    return models
  }

  throw new LlmError(
    'the endpoint\'s model listing has no "data" array; enter this provider\'s models by hand',
    'DISCOVERY_FAILED',
  )
}

/** One entry of Ollama's `POST /api/show` reply that this reader consumes. */
interface OllamaShowReply {
  model_info?: Record<string, unknown>
}

/**
 * Find the model's trained context length in an `/api/show` reply. The fact
 * lives under an architecture-prefixed key (`llama.context_length`,
 * `qwen2.context_length`, …), so match on the suffix rather than any one
 * family.
 * @param reply - the parsed show reply.
 * @returns the largest context length reported, or `undefined` when none is.
 */
function contextLengthFromShow(reply: OllamaShowReply): number | undefined {
  let found: number | undefined
  for (const [key, value] of Object.entries(reply.model_info ?? {})) {
    if (!key.endsWith('.context_length')) continue
    const candidate = capacity(value)
    if (candidate !== undefined && (found === undefined || candidate > found)) found = candidate
  }
  return found
}

/**
 * Fill each discovered Ollama model's context window from its own
 * `POST /api/show` reply — the one place the running server states the real
 * value, so the surface never invents capacities. Best-effort per model: a
 * failed or unreadable show reply leaves that model without a context window
 * rather than failing a listing that already succeeded.
 * @param base - the server root the tags listing came from.
 * @param models - the ids read from the listing, updated in place.
 * @param headers - the probe headers (credential and attribution) to reuse.
 * @param signal - the caller's cancellation signal.
 */
async function enrichOllamaCapabilities(
  base: string,
  models: LlmDiscoveredModel[],
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const showUrl = `${base}/api/show`
  for (const model of models) {
    try {
      const response = await fetch(showUrl, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ model: model.id }),
        ...signal === undefined ? {} : { signal },
      })
      /* v8 ignore next 3 -- a local server answering the listing but refusing every show is pathological; skip keeps the listing usable. */
      if (!response.ok) continue
      const reply = JSON.parse(await readBounded(response, showUrl)) as OllamaShowReply
      const contextWindow = contextLengthFromShow(reply)
      if (contextWindow !== undefined) model.contextWindow = contextWindow
    } catch {
      // Enrichment is additive metadata; a missing value degrades to the
      // route's configured default instead of denying a working listing.
    }
  }
}

/**
 * Accept one probe key, or refuse it before the header is built. Without this
 * the `fetch` below would throw a ByteString `TypeError` that this function's
 * catch reports as `could not reach <url>` — blaming the network for a local,
 * deterministic fault.
 * @param raw - the key typed into the form or read from storage.
 * @returns the trimmed, usable key.
 */
function usableProbeKey(raw: string): string {
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  throw new LlmError(
    checked.reason === 'empty'
      ? 'this provider\'s API key is blank; enter it on the Models page, or clear it to probe unauthenticated'
      : 'this provider\'s API key contains characters no HTTP header can carry; paste the raw key only',
    INVALID_CREDENTIAL_CODE,
  )
}

/**
 * Interrogate one draft provider endpoint for the models it advertises.
 * @param request - the endpoint, protocol, and one-shot credential to use.
 * @param storedApiKey - the credential the named route already stored, asked
 *   for only when the draft carries none and only on the path that reaches the
 *   network. A configuration surface never holds a stored secret — it edits a
 *   redacted descriptor — so without this an already-configured route would be
 *   interrogated unauthenticated and answer 401.
 * @returns the advertised models in endpoint order.
 * @throws LlmError when the protocol has no readable listing, the endpoint
 *   refuses or fails the request, or the reply is not a model listing.
 */
export async function discoverModels(
  request: LlmModelDiscoveryRequest,
  storedApiKey?: () => Promise<string | undefined>,
): Promise<readonly LlmDiscoveredModel[]> {
  // A catalog route already has its answer, and a better one: the installed
  // entries carry context windows and output caps no listing endpoint reports.
  // Ollama is exempt: its models depend on what is locally pulled.
  if (request.provider !== undefined && request.provider !== 'ollama') {
    const installed = catalogModels(request.provider)
    if (installed.size > 0) {
      return [...installed.values()].map(model => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      }))
    }
  }
  const effectiveBaseURL = request.baseURL ?? (request.provider === 'ollama' ? OLLAMA_BASE_URL : undefined)
  if (effectiveBaseURL === undefined || effectiveBaseURL.length === 0) {
    throw new LlmError(
      `pi-ai ships no catalog for provider "${request.provider ?? ''}", so its models can only come from its`
      + " endpoint; set a baseURL, or enter this provider's models by hand",
      'DISCOVERY_FAILED',
    )
  }
  // A draft that has not chosen a protocol yet is asked as OpenAI Chat
  // Completions: it is the shape a gateway is overwhelmingly likely to speak,
  // and the alternative — refusing until the field is filled — would withhold
  // the action from the case it exists for. The cost is a misdirected message
  // when the endpoint speaks something else (an Anthropic gateway answers 401,
  // which reads as a credential problem), and hand-entry remains the way out.
  const api = request.api ?? 'openai-completions'
  if (!LISTABLE_PROTOCOLS.has(api)) {
    throw new LlmError(
      `pi-ai protocol "${api}" has no model listing this build can read; enter this provider's models by hand`,
      'DISCOVERY_UNSUPPORTED',
    )
  }
  const candidateUrls = listingUrls(effectiveBaseURL, request.provider)
  // A key typed into the form wins: it is the one the user is testing, and it
  // may be the replacement for exactly the stored key that is failing. The
  // stored one is only asked for here, past the catalog short-circuit and the
  // protocol check, so a route answered from the registry costs no credential
  // lookup — and no diagnostic about a credential it never needed.
  // A probe carrying no key stays unauthenticated, which is how a route that
  // relies on the provider's own ambient discovery is meant to be asked.
  const supplied = request.apiKey ?? await storedApiKey?.()
  const apiKey = supplied === undefined ? undefined : usableProbeKey(supplied)

  let lastError: unknown
  let lastStatus = 0
  let lastUrl = candidateUrls[0] as string

  for (const url of candidateUrls) {
    lastUrl = url
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` },
          ...attributionHeaders(),
        },
        ...request.signal === undefined ? {} : { signal: request.signal },
      })
    } catch (error: unknown) {
      if (request.signal?.aborted) {
        throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
      }
      lastError = error
      continue
    }

    if (!response.ok) {
      lastStatus = response.status
      if (response.status === 401 || response.status === 403) {
        throw new LlmError(`${url} answered ${response.status}; check the API key`, 'DISCOVERY_FAILED')
      }
      if (response.status === 404) {
        continue
      }
      throw new LlmError(`${url} answered ${response.status}`, 'DISCOVERY_FAILED')
    }

    let text: string
    try {
      text = await readBounded(response, url)
    } catch (error: unknown) {
      if (request.signal?.aborted) {
        throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
      }
      throw error
    }

    let body: unknown
    try {
      body = JSON.parse(text)
    } catch (error: unknown) {
      throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
    }

    const models = readListing(body, request.provider)
    // The native tags listing carries no capacity facts; the running server
    // states each model's real context length only through /api/show. The
    // probe headers (credential + attribution) ride along unchanged.
    if (request.provider === 'ollama' && url.endsWith('/api/tags') && models.length > 0) {
      await enrichOllamaCapabilities(
        url.slice(0, -'/api/tags'.length),
        models,
        {
          accept: 'application/json',
          ...apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` },
          ...attributionHeaders(),
        },
        request.signal,
      )
    }
    return models
  }

  if (lastStatus !== 0) {
    throw new LlmError(
      `${lastUrl} answered ${lastStatus}${lastStatus === 401 || lastStatus === 403 ? '; check the API key' : ''}`,
      'DISCOVERY_FAILED',
    )
  }

  throw new LlmError(`could not reach ${lastUrl}`, 'DISCOVERY_FAILED', { cause: lastError })
}
