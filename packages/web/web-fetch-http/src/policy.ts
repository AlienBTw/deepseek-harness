/**
 * URL validation, destination IP policy, and content-type classification for
 * the local HTTP(S) fetch provider. Destination checks resolve DNS then classify
 * addresses; the provider's `fetch()` composes these with transport (redirect
 * following, byte caps, decoding).
 *
 * @module @maple/web-fetch-http/policy
 */

import { lookup as defaultDnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { WebError } from '@maple/web'

/** DNS lookup compatible with `dns.promises.lookup(..., { all: true })`. */
export type DnsLookupAll = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>

/** Test / process override for hostname resolution. Defaults to `dns.promises.lookup`. */
let dnsLookupAll: DnsLookupAll = defaultDnsLookup

/**
 * Replace the DNS lookup used by {@link assertPublicFetchDestination}.
 * Production code never calls this; tests inject a stub because ESM cannot
 * spy on `node:dns/promises` exports.
 *
 * @param lookup - resolver to use, or `undefined` to restore the Node default.
 */
export function setDnsLookupForTests(lookup: DnsLookupAll | undefined): void {
  dnsLookupAll = lookup ?? defaultDnsLookup
}

/** The body kinds this provider decodes. */
export type FetchableKind = 'html' | 'text'

/**
 * Addresses refused when `allowPrivateNetwork` is false: RFC1918 private,
 * loopback, link-local (including cloud metadata `169.254.169.254`), CGNAT,
 * multicast, IPv6 ULA/link-local/multicast/loopback/unspecified, and
 * IPv4-mapped forms of the IPv4 ranges above.
 */
const BLOCKED_DESTINATIONS = new BlockList()
BLOCKED_DESTINATIONS.addSubnet('0.0.0.0', 8, 'ipv4')
BLOCKED_DESTINATIONS.addSubnet('10.0.0.0', 8, 'ipv4')
BLOCKED_DESTINATIONS.addSubnet('100.64.0.0', 10, 'ipv4')
BLOCKED_DESTINATIONS.addSubnet('127.0.0.0', 8, 'ipv4')
BLOCKED_DESTINATIONS.addSubnet('169.254.0.0', 16, 'ipv4')
BLOCKED_DESTINATIONS.addSubnet('172.16.0.0', 12, 'ipv4')
BLOCKED_DESTINATIONS.addSubnet('192.168.0.0', 16, 'ipv4')
BLOCKED_DESTINATIONS.addSubnet('224.0.0.0', 4, 'ipv4')
BLOCKED_DESTINATIONS.addAddress('::', 'ipv6')
BLOCKED_DESTINATIONS.addAddress('::1', 'ipv6')
BLOCKED_DESTINATIONS.addSubnet('fc00::', 7, 'ipv6')
BLOCKED_DESTINATIONS.addSubnet('fe80::', 10, 'ipv6')
BLOCKED_DESTINATIONS.addSubnet('ff00::', 8, 'ipv6')

/**
 * Validate a request URL against the basic transport hygiene the provider
 * enforces before any network access: http(s) only, no embedded credentials,
 * bounded length. Returns the parsed `URL`. Throws {@link WebError} otherwise.
 * Destination IP policy is {@link assertPublicFetchDestination}, applied after
 * this check on every hop.
 *
 * @param input - the raw URL string from the fetch request.
 * @param maxUrlLength - inclusive upper bound on `input`'s length.
 * @returns the parsed `URL`.
 */
export function validateFetchUrl(input: string, maxUrlLength: number): URL {
  if (input.length > maxUrlLength) {
    throw new WebError(`URL exceeds the maximum length of ${maxUrlLength}`, 'WEB_INVALID_URL')
  }
  let url: URL
  try {
    url = new URL(input)
  } catch (error: unknown) {
    throw new WebError(`invalid URL: ${input}`, 'WEB_INVALID_URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, 'WEB_INVALID_URL')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebError('credentials in URLs are not allowed', 'WEB_BLOCKED_URL')
  }
  return url
}

/**
 * Whether a literal IP address is a disallowed fetch destination under the
 * default SSRF policy (private, loopback, link-local, multicast, metadata).
 * IPv4-mapped IPv6 addresses are classified by their embedded IPv4 address.
 *
 * @param address - a dotted IPv4 or IPv6 address string (no brackets).
 * @returns true when the address must not be fetched unless `allowPrivateNetwork` is set.
 */
export function isBlockedIpAddress(address: string): boolean {
  const normalized = unwrapIpv4Mapped(address)
  const version = isIP(normalized)
  if (version === 4) return BLOCKED_DESTINATIONS.check(normalized, 'ipv4')
  if (version === 6) return BLOCKED_DESTINATIONS.check(normalized, 'ipv6')
  return true
}

/**
 * Resolve `url.hostname` (or use a literal IP) and refuse any address that
 * {@link isBlockedIpAddress} rejects, unless `allowPrivateNetwork` is true.
 * Call on the initial URL and again on every redirect hop.
 *
 * @param url - validated http(s) URL for this hop.
 * @param allowPrivateNetwork - explicit escape hatch; when true, skip IP checks.
 * @returns resolves when the destination is allowed.
 */
export async function assertPublicFetchDestination(url: URL, allowPrivateNetwork: boolean): Promise<void> {
  if (allowPrivateNetwork) return

  const host = url.hostname
  if (isIP(host) !== 0) {
    if (isBlockedIpAddress(host)) {
      throw new WebError(`destination address ${host} is not allowed`, 'WEB_BLOCKED_URL')
    }
    return
  }

  let addresses: Array<{ address: string }>
  try {
    addresses = await dnsLookupAll(host, { all: true, verbatim: true })
  } catch (error: unknown) {
    throw new WebError(`web fetch failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  for (const { address } of addresses) {
    if (isBlockedIpAddress(address)) {
      throw new WebError(`destination resolves to disallowed address ${address}`, 'WEB_BLOCKED_URL')
    }
  }
}

/**
 * Two URLs are same-origin when scheme, hostname, and port match. A redirect
 * that crosses origins is refused so each new origin requires a fresh tool call
 * (and thus a fresh provider/permission decision).
 *
 * @param a - one of the two URLs to compare.
 * @param b - the other URL to compare.
 * @returns true when `a` and `b` share scheme, hostname, and port.
 */
export function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
}

/**
 * Classify a response `Content-Type` into a decodable body kind, or `undefined`
 * for an unsupported (e.g. binary) type. `text/html` and `application/xhtml+xml`
 * are `html`; other `text/*` plus a few structured text types are `text`.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none (unsupported).
 * @returns the decodable kind, or `undefined` for an unsupported type.
 */
export function classifyContentType(contentType: string | null): FetchableKind | undefined {
  const mime = (contentType ?? '').replace(/;.*$/s, '').trim().toLowerCase()
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (mime.startsWith('text/')) return 'text'
  if (mime === 'application/json' || mime === 'application/xml' || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text'
  return undefined
}

/**
 * Extract the `charset` parameter from a response `Content-Type`, lower-cased,
 * or `undefined` when absent. The provider feeds this label to `TextDecoder`
 * so a non-UTF-8 response is decoded with its declared encoding rather than
 * silently mangled into replacement characters.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none.
 * @returns the lower-cased charset label, or `undefined` when none is declared.
 */
export function parseCharset(contentType: string | null): string | undefined {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? '')
  return match?.[1]?.trim().toLowerCase()
}

/**
 * Build a `TextDecoder` for the declared charset, falling back to UTF-8 when
 * none is declared. Throws {@link WebError} `WEB_UNSUPPORTED_CONTENT_TYPE` when
 * the label is present but not a charset `TextDecoder` recognizes — better to
 * fail loudly than return mojibake.
 *
 * @param charset - the declared charset label (from {@link parseCharset}), or
 *   `undefined` to default to UTF-8.
 * @returns a decoder for the declared (or defaulted) encoding.
 */
export function decoderForCharset(charset: string | undefined): TextDecoder {
  if (charset === undefined) return new TextDecoder('utf-8')
  try {
    return new TextDecoder(charset)
  } catch (error: unknown) {
    throw new WebError(`unsupported charset "${charset}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE', { cause: error })
  }
}

/** Map `::ffff:a.b.c.d` / `::ffff:HHHH:LLLL` to dotted IPv4 for BlockList checks. */
function unwrapIpv4Mapped(address: string): string {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)
  if (dotted?.[1] !== undefined) return dotted[1]
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address)
  if (hex?.[1] === undefined || hex[2] === undefined) return address
  const hi = Number.parseInt(hex[1], 16)
  const lo = Number.parseInt(hex[2], 16)
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
}
