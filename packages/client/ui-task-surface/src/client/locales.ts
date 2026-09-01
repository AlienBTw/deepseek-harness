/** `taskSurface` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'dock.aria': '任务面板',
  'action.submit': '提交',
  'error.not-open': '任务面板已关闭',
  'error.invalid-submission': '提交内容无效',
  'error.submission-pending': '提交处理中，请稍候',
  'error.generic': '提交失败',
} satisfies Record<string, string>

/** The taskSurface namespace key union. */
export type TaskSurfaceKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'dock.aria': 'Task panel',
  'action.submit': 'Submit',
  'error.not-open': 'Task panel is no longer open',
  'error.invalid-submission': 'Submission is invalid',
  'error.submission-pending': 'Submission is still processing',
  'error.generic': 'Submission failed',
} satisfies Record<TaskSurfaceKey, string>
