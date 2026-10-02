# @maple/client-ui-task-surface

English | [中文](README.zh.md)

Task Surface UI plugin, browser half: `TaskSurfaceDock` is the actionable card in the `conversation.input.dock` composer-context stack (order 30, after Queue), and `TaskSurfaceRow` is the keyed `tool.call.toolview` entry for `show_task_surface`. The active correlation arrives through `useProjection('taskSurface')`; the inject face loads the authoritative model through `ctx.remote.taskSurface.getActive`, submits through `ctx.remote.taskSurface.submit`, and dismisses through `ctx.remote.taskSurface.dismiss`. When no surface is active, the dock renders nothing.

The dock renders declarative `TaskSurfaceModelV1` sections (markdown, metric, diff, table) and fields (choice, text, order). Conditional fields, uploads, and client-side fetching stay out of v1.

The `/client` exports are the plugin body (`apply`/`inject`) and the injected verb face types.

## Model Experience

Indirectly, through `taskSurface/submit`: an accepted submission queues one ordinary visible user message that starts the next turn. Dismiss appends `task-surface/dismissed` without a prompt. The dock itself adds no prompt content.

#### KV Cache effect

None unless the queued user message is admitted into a later model request; the dock does not alter the cache directly.

## Known Limitations and Deferred Work

- **Conditional fields / uploads / client fetch** — deferred until a later protocol bump; v1 keeps a closed declarative vocabulary only.
