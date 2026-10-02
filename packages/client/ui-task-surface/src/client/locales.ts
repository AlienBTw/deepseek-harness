/** `taskSurface` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'dock.aria': '任务面板',
  'action.submit': '提交',
  'action.dismiss': '关闭',
  'order.moveUp': '上移',
  'order.moveDown': '下移',
  'row.title': '任务面板',
  'row.waiting': '等待提交',
  'row.failed': '任务面板失败',
  'row.stopped': '任务面板已中止',
  'error.not-open': '任务面板已关闭',
  'error.invalid-submission': '提交内容无效',
  'error.submission-pending': '提交处理中，请稍候',
  'error.generic': '操作失败',
} satisfies Record<string, string>

/** The taskSurface namespace key union. */
export type TaskSurfaceKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'dock.aria': 'Task panel',
  'action.submit': 'Submit',
  'action.dismiss': 'Dismiss',
  'order.moveUp': 'Move up',
  'order.moveDown': 'Move down',
  'row.title': 'Task Surface',
  'row.waiting': 'Awaiting submission',
  'row.failed': 'Task Surface failed',
  'row.stopped': 'Task Surface stopped',
  'error.not-open': 'Task panel is no longer open',
  'error.invalid-submission': 'Submission is invalid',
  'error.submission-pending': 'Submission is still processing',
  'error.generic': 'Action failed',
} satisfies Record<TaskSurfaceKey, string>
