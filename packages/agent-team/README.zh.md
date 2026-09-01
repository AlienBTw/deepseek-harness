# agent-team/ — 隐式 Root Agent Teams

[English](README.md) | 中文

隐式 Root Agent Teams 的持久 peer 协作：roster、mailbox、共享任务 DAG 与 scoped 模型工具。[Agent Teams Agent Note](../../.agents/notes/implemented/feature/2026-08-05-agent-teams.zh.md)负责协作决策；[Team 子系统目录](../../docs/subsystems/agent-team.zh.md)记录持久形态与服务 API。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`agent-team/`](agent-team/README.zh.md) | Team 服务、持久语义、任务板 projection | `ctx.agentTeams` |
| [`tool-agent-team/`](tool-agent-team/README.zh.md) | Scoped 模型面向 Team 工具 | — |
