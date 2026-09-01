# @maple/tool-task-surface

English | [中文](README.zh.md)

Model-facing `show_task_surface` tool for presenting interactive UI panels and concluding the turn to await human input.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`show_task_surface` schema](../../../docs/tool-catalog.md#mapletool-task-surface).

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains the declarative TaskSurfaceModelV1 in arguments. The tool concludes the turn, emitting presentation metadata for UI rendering, and returns an acknowledgement with the unique surface ID and title.

#### Token effect

The declarative JSON structure in tool arguments contributes tokens to the message turn.

#### KV Cache effect

Appends linearly to the turn transcript without prefix invalidation.

## Known Limitations and Deferred Work

- Currently requires clients that support task surface rendering.
