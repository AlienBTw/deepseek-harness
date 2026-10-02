# Agent Note: web-fetch-http SSRF destination policy

Status: implemented

English | [中文](2026-09-28-web-fetch-ssrf-destination-policy.zh.md)

## Problem

`@maple/web-fetch-http` accepted any http(s) URL after protocol, credential, and length checks. A model (or redirect) could target loopback, RFC1918, link-local cloud metadata (`169.254.169.254`), or multicast. The [web capability seam](2026-06-24-web-capability-seam.md) deferred full SSRF protection and required deployments that can reach internal targets not to enable fetch — so mounting the only HTTP fetch backend still left an SSRF primitive.

## Decision

Ship a default-on destination policy in `@maple/web-fetch-http`:

1. After `validateFetchUrl`, resolve the hop hostname (or use a literal IP) and refuse addresses classified as private (RFC1918 + CGNAT `100.64/10`), loopback, link-local, multicast, IPv6 ULA/link-local/multicast/loopback/unspecified, or IPv4-mapped forms of those IPv4 ranges (`WEB_BLOCKED_URL`).
2. Run the same check on every redirect hop before same-origin validation so a Location to a private IP and same-host DNS rebinding both fail closed.
3. The only escape hatch is explicit config `allowPrivateNetwork: true` (default `false`) for trusted lab compositions (loopback fixtures, local integration tests). No other setting turns the checks off.

Classification lives in `policy.ts` (`isBlockedIpAddress`, `assertPublicFetchDestination`); the provider calls the assert on the initial URL and each redirect target. Tests inject DNS via `setDnsLookupForTests` because ESM cannot spy on `node:dns/promises`.

## Alternatives considered

- **Hostname/prefix denylist without DNS.** Rejected: misses rebinding and IP literals; the seam note already required resolve-then-verify.
- **Allow a hostname if any public A/AAAA exists.** Rejected: the connect path may still pick a private address.
- **Pin the TCP connection to the verified address in the same change.** Deferred: closes lookup-to-connect TOCTOU; Wave 1.5 delivers post-resolve checks and per-hop revalidation first. The package README still lists pin-to-IP as deferred.
- **Default `allowPrivateNetwork: true` on test paths via environment sniffing.** Rejected: that is a silent escape hatch; lab configs and tests must set the flag explicitly.

## Consequences

**Fetch is no longer an SSRF primitive under default config.** Mounting `web-fetch-http` without `allowPrivateNetwork` refuses non-public destinations after DNS.

**Lab and snapshot compositions that fetch loopback must set `allowPrivateNetwork: true`.** ACP web-fetch fixtures and package tests that drive `127.0.0.1` open the flag explicitly in config or `HttpFetchLimits`.

**Pin-to-verified-IP remains deferred.** Between `dns.lookup` and `fetch(hostname)`, resolution can still change before connect; per-hop re-resolve reduces redirect rebinding but does not close same-hop TOCTOU.

## Verification

- Unit tests for blocked IPv4/IPv6 ranges (including metadata link-local and IPv4-mapped forms), `allowPrivateNetwork` bypass, redirect-to-private literal, and same-host DNS rebind across redirect hops.
- Plugin default (`allowPrivateNetwork: false`) refuses loopback; explicit `true` allows the package's loopback fixture server.
