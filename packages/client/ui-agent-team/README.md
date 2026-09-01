# @maple/client-ui-agent-team

English | [中文](README.zh.md)

Agent Teams task-board surface plugin, browser half: a read-only dock in `conversation.input.dock` (order 20) that lists non-deleted Team tasks from `useProjection('agentTeam')`. An empty or absent projection renders nothing.

## Model Experience

None. The dock is read-only and does not append session events or model-visible input.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **Read-only board** — task mutations stay on the model tools and Remote APIs; the dock does not edit tasks or roster rows.
