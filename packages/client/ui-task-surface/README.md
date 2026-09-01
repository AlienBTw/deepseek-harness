# @maple/client-ui-task-surface

English | [中文](README.zh.md)

Task Surface UI plugin, browser half: `TaskSurfaceDock` is the actionable card in the `conversation.input.dock` composer-context stack (order 30, after Queue). The active correlation arrives through `useProjection('taskSurface')`; the inject face loads the authoritative model through `ctx.remote.taskSurface.getActive` and submits through `ctx.remote.taskSurface.submit`. When no surface is active, the dock renders nothing.

The `/client` exports are the plugin body (`apply`/`inject`) and the injected verb face types.

## Model Experience

Indirectly, through `taskSurface/submit`: an accepted submission queues one ordinary visible user message that starts the next turn. The dock itself adds no prompt content.

#### KV Cache effect

None unless the queued user message is admitted into a later model request; the dock does not alter the cache directly.

## Known Limitations and Deferred Work

- **M1.3 minimal panel** — the dock shows the active title and one submit control only; declarative fields, dismiss, and the keyed transcript row are deferred.
