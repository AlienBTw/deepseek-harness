# @maple/desktop

English | [中文](README.zh.md)

The Maple desktop shell: one native window over the harness's own local server. The shell owns windowing and process lifetime only — the RPC gateway, plugin roster, tools, and native directory picker all stay owned by the composed `web` profile, which the shell boots as a child process.

## How it works

`src-tauri/src/main.rs` spawns `dsh web --no-open --port 0` (OS-chosen port, no browser handoff), watches the child's stdout for the readiness line `dsh web: http://127.0.0.1:<port>` that `@deepseek-ai/maple-web-app` prints once bound, then navigates the window from the bundled splash page to that URL. Every capability the browser surface has — RPC gateway, plugin roster, native directory picker — stays owned by the harness composition; the shell adds only windowing and lifetime.

No Tauri IPC is exposed to the loaded page: the UI talks to the harness exclusively through its own `/api` origin.

Lifetime guarantees:

- The host child runs inside a kill-on-close Windows job object, so it cannot outlive the shell even when the shell dies without running cleanup — port and file watchers are reaped by the kernel.
- Closing the window terminates the host; a host exit closes the shell; an intentional kill is never reported as a crash.
- Fatal startup conditions (repository root not found, spawn failure, invalid `MAPLE_DESKTOP_LAUNCH`, readiness deadline) surface as a native dialog in release builds, where no stderr exists to read, and on stderr in debug ones.
- A source-plane boot silent for 45 seconds prints one hint naming the built-binary fallback; the 180-second deadline still closes the shell.
- A second launch does not boot a second host: the existing window takes focus.

## Usage

```sh
pnpm install        # once per checkout
pnpm desktop:dev    # debug shell + host launched from source through tsx
```

A packaged build runs the built CLI instead of the source tree, so build first:

```sh
pnpm run build      # produces apps/cli/lib/bin.js
pnpm desktop:build  # NSIS installer under src-tauri/target/release/bundle
```

The repository root is located by walking up from the working directory and the executable, then by reading the `repo-root.txt` hint file under this app's data directory (`%APPDATA%\app.maple.desktop\`) or a `maple-desktop.repo` file beside the executable; `MAPLE_DESKTOP_REPO_ROOT` overrides everything. Double-clicking an installed binary works once either hint file names a checkout.

### Launch plane

Debug builds launch the CLI from source through the tsx ESM hook; release builds run `apps/cli/lib/bin.js`. Set `MAPLE_DESKTOP_LAUNCH=built` or `=source` to override either default. The override matters when the tsx hook stalls under a deeply nested process tree (observed in agent sandboxes): after `pnpm run build`, `MAPLE_DESKTOP_LAUNCH=built pnpm desktop:dev` boots from the bundle instead.

## Known Limitations and Deferred Work

- A packaged binary still resolves the repository checkout and a system `node`: true standalone bundling (sidecar Node runtime plus the built CLI as Tauri resources) is not implemented.
- Window close terminates the host through `TerminateProcess`, which skips the harness's graceful disposal (config watchers, telemetry drain); sessions are lazily persisted so durable content is unaffected.
- macOS and Linux are untested: the job-object guard is Windows-only, and other platforms rely solely on explicit cleanup.
