# agent-team/ — implicit-root Agent Teams

English | [中文](README.zh.md)

Durable peer coordination for implicit-root Agent Teams: roster, mailbox, shared task DAG, and scoped model tools. The [Agent Teams Agent Note](../../.agents/notes/implemented/feature/2026-08-05-agent-teams.md) owns coordination decisions; the [Team subsystem catalog](../../docs/subsystems/agent-team.md) records durable shapes and the service API.

| Package | Role | ctx key |
|---|---|---|
| [`agent-team/`](agent-team/README.md) | Team service, durable semantics, task-board projection | `ctx.agentTeams` |
| [`tool-agent-team/`](tool-agent-team/README.md) | Scoped model-facing Team tools | — |
