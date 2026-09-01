/** `agentTeam` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'dock.aria': '团队任务板',
  'title': '团队任务',
  'status.pending': '待处理',
  'status.in_progress': '进行中',
  'status.completed': '已完成',
  'blocked': '等待依赖',
} satisfies Record<string, string>

/** The agentTeam namespace key union. */
export type AgentTeamKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'dock.aria': 'Team task board',
  'title': 'Team tasks',
  'status.pending': 'Pending',
  'status.in_progress': 'In progress',
  'status.completed': 'Completed',
  'blocked': 'Blocked',
} satisfies Record<AgentTeamKey, string>

/** Dictionary namespace owned by this plugin. */
export const NS = 'agentTeam'
