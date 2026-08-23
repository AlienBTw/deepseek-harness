# Agent Note: Telemetry endpoint stays on DeepSeek-hosted collector

Status: implemented

English | [中文](2026-08-23-telemetry-endpoint-deferred.zh.md)

## Problem

The rebrand migrated all product-facing names from DeepSeek to Maple, but the OTLP telemetry endpoint (`harness-telemetry.deepseeksvc.com`) has no Maple-hosted equivalent. Changing the URL without a working collector would silently drop all telemetry.

## Decision

The telemetry exporter URL stays on `harness-telemetry.deepseeksvc.com` for now. The `MAPLE_TELEMETRY_OTLP_URL` env var (renamed from `DSH_TELEMETRY_OTLP_URL`) already allows per-deployment overrides, so a deployment that wants a different collector can set it without a code change. The base-bundle default is a known deferred item, not an oversight.

## Alternatives considered

**Why not stand up a new collector now?** No Maple-hosted infrastructure exists yet; deploying one is a separate operational task outside this repository's scope.

**Why not remove the default URL entirely?** Telemetry is opt-in (`MAPLE_TELEMETRY_MODE` defaults to `DISABLED`), so the URL is inert unless a deployment explicitly enables reporting. Removing it would break the first deployment that opts in.

## Consequences

The `deepseeksvc.com` hostname appears in one config default (`packages/bundle/base/cordis.patch.yml`). A deployment enabling telemetry without overriding `MAPLE_TELEMETRY_OTLP_URL` will send data to the DeepSeek-hosted collector. This is acceptable while the product is pre-release and telemetry is off by default.
