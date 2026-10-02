# Agent Note: Session retention, GC, and paginated list

Status: implemented

English | [中文](2026-09-28-session-retention-gc-paginated-list.zh.md)

## Problem

Session persistence could list every header and had no deletion or retention surface. Web reconnect pulled an unbounded `session.list`, and cold blank probes ran for every stored session. Deployments needed `delete(id)`, Config-driven GC (`maxAgeDays`, `maxSessions`), and a paginated list wire so the cold path only summarizes one page.

## Decision

`SessionPersistence` gains `delete(id)`, `listPage({ cursor, limit })`, and `gc()`. Shared helpers in `retention.ts` own newest-first keyset pagination and victim selection (age first, then count). JSONL and SQLite Config accept optional `maxAgeDays` / `maxSessions`; `gc` skips live attached sessions. Delete refuses while a live Session is attached and treats absence as success.

ApiProxy `session.list` takes optional `limit` (default 50, max 200) and returns `nextCursor`. It keyset-pages attached summaries plus cold headers, then blank-probes only the selected cold page. The Web `SessionManager.refreshList` walks pages until exhausted so the client snapshot stays complete while each Host round-trip stays bounded.

## Alternatives considered

**Change `list()` to always return a page.** Rejected as a silent break for every in-process caller that expects the full header vector; `listPage` is additive and `list` remains the complete metadata scan.

**Offset cursors.** Rejected because inserts between pages duplicate or skip rows; keyset `(activityAt, id)` stays stable under append-only stores.

**Auto-GC on every list.** Rejected because listing is an observation path; GC stays an explicit entrypoint operators or boot hooks can schedule.

## Consequences

Persistence tests cover pagination and victim selection; backends implement durable delete. Search still builds the full visible set because ranking needs the authorization universe. SQLite may later seek without loading every header; JSONL still scans header lines for listing.
