# Agent Note: Desktop shell as one window over the composed web profile

Status: implemented

English | [中文](2026-08-22-desktop-shell-over-web-profile.zh.md)

## Problem

The harness's browser surface already serves a complete GUI — RPC gateway, plugin roster, tools, native directory picker — over loopback HTTP, but reaching it requires a terminal (`dsh web`) and a browser tab, and its lifetime is detached from anything the operator closes. A desktop application that re-implemented any of that surface would fork the product; wrapping it in a native window without owning its process leaves orphaned servers and silent failures.

## Decision

`apps/desktop` is a Tauri v2 binary whose entire job is windowing and process lifetime over the existing `web` profile composition. It spawns `node <cli> web --no-open --port 0` as a child, parses the readiness line `dsh web: http://127.0.0.1:<port>` the web bundle prints on bind, and navigates one webview from a bundled splash page to that URL. The loaded page gets no Tauri IPC: the UI keeps talking to its own `/api` origin.

Lifetime and failure behavior:

- The child runs inside a kill-on-close Windows job object, so kernel handle cleanup reaps it even when the shell dies without running its own cleanup.
- Closing the window terminates the host; a host exit closes the shell; an intentional kill is never reported as a crash (`KILLING_HOST` gates the stdout pump).
- Fatal startup conditions surface in a native dialog in release builds (`windows_subsystem` gives them no stderr) and on stderr in debug builds.
- Launch plane is debug → source through tsx, release → built `apps/cli/lib/bin.js`; `MAPLE_DESKTOP_LAUNCH=built|source` overrides either default. A source-plane boot silent for 45 seconds prints one hint naming the built fallback before the 180-second deadline exits.
- A second launch focuses the existing window instead of booting a second host.

## Alternatives considered

**Why not embed the frontend dist and speak to a headless host over IPC?** Bundling the dist makes the shell own API routing, plugin serving, and trust fencing that `@deepseek-ai/dsh-web-app` already owns, and every harness capability would need a parallel path into the webview. Serving through the real composition keeps one surface with one owner.

**Why not make Tauri dialogs the directory-picker backend?** The seam already composes backends behind `ctx.directoryPicker`; a third backend would duplicate the Win32 koffi implementation for no capability gain, and the koffi chooser works unchanged under a spawned host.

**Why not auto-fallback to the built CLI when tsx stalls?** Killing and relaunching mid-boot adds a second failure mode (orphaned first attempt, double port probing) to mask an environment-specific stall. The loud hint plus explicit override keeps one launch path per invocation.

## Consequences

A packaged installer still requires the repository checkout and a system `node` — true standalone bundling (sidecar runtime plus bundled CLI) remains deferred. Window close terminates the host via `TerminateProcess`, skipping graceful disposal; lazy session persistence keeps durable content unaffected. macOS and Linux are untested, where only explicit cleanup exists because the job-object guard is Windows-only.
