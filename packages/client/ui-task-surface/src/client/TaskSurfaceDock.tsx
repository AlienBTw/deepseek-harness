/**
 * TaskSurfaceDock: the actionable Task Surface card above the composer. The
 * projection carries only the active correlation; the inject face loads the
 * authoritative model through getActive and submits through the Remote API.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TaskSurfaceModelV1, TaskSurfaceProjection, TaskSurfaceSubmissionId } from '@maple/task-surface/client'
import type { PropsLocale } from '@maple/client-ui-slots'
import type { TaskSurfaceDockActions } from './slots.ts'
import type { TaskSurfaceKey } from './locales.ts'
import css from './TaskSurfaceDock.module.css'

const REJECT_REASON_LABELS = {
  'not-open': 'error.not-open',
  'invalid-submission': 'error.invalid-submission',
  'submission-pending': 'error.submission-pending',
  stale: 'error.generic',
} as const satisfies Record<string, TaskSurfaceKey>

function rejectMessage(reason: string, t: PropsLocale<'taskSurface'>['t']): string {
  const key = REJECT_REASON_LABELS[reason as keyof typeof REJECT_REASON_LABELS]
  return key === undefined ? t('error.generic') : t(key)
}

export interface TaskSurfacePanelProps extends TaskSurfaceDockActions {
  /** Active correlation from the session projection, or null when closed. */
  active: TaskSurfaceProjection['active']
}

/** Presentation panel: title plus one submit control wired to the inject face. */
export function TaskSurfacePanel({
  active,
  onGetActive,
  onSubmit,
  t,
}: TaskSurfacePanelProps & PropsLocale<'taskSurface'>) {
  const [model, setModel] = useState<TaskSurfaceModelV1 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)

  useEffect(() => {
    if (active === null) {
      setModel(null)
      setError(null)
      return
    }
    let cancelled = false
    void onGetActive().then((result) => {
      if (cancelled) return
      if (result.active && result.surfaceId === active.surfaceId) {
        setModel(result.model)
        setError(null)
      } else {
        setModel(null)
      }
    })
    return () => { cancelled = true }
  }, [active, onGetActive])

  const handleSubmit = useCallback(async () => {
    if (active === null || model === null || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError(null)
    const result = await onSubmit({
      surfaceId: active.surfaceId,
      submissionId: crypto.randomUUID() as TaskSurfaceSubmissionId,
      values: {},
    })
    pendingRef.current = false
    setPending(false)
    if (!result.accepted) setError(rejectMessage(result.reason, t))
  }, [active, model, onSubmit, t])

  if (active === null || model === null) return null

  return (
    <div className={css.dock} data-task-surface-dock aria-label={t('dock.aria')}>
      <div className={css.bar}>
        <span className={css.title}>{model.title}</span>
        {error !== null && <span className={css.error} role="alert">{error}</span>}
        <button
          type="button"
          className={css.submitBtn}
          disabled={pending}
          onClick={() => { void handleSubmit() }}
        >
          {model.submit.label || t('action.submit')}
        </button>
      </div>
    </div>
  )
}

/** Full props of the dock entry: InputZone owner share + session standard kit + injected verbs + locale seat. */
export type TaskSurfaceDockProps =
  import('@maple/client-ui-slots').PropsRuntime<'conversation.input.dock'>
  & TaskSurfaceDockActions
  & PropsLocale<'taskSurface'>

/** Dock adapter: reads the host-computed taskSurface projection correlation. */
export function TaskSurfaceDock({ useProjection, onGetActive, onSubmit, t }: TaskSurfaceDockProps) {
  const projection = useProjection('taskSurface')
  const active = projection?.active ?? null
  return (
    <TaskSurfacePanel
      active={active}
      onGetActive={onGetActive}
      onSubmit={onSubmit}
      t={t}
    />
  )
}
