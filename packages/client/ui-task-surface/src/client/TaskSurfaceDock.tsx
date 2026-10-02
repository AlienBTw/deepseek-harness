/**
 * TaskSurfaceDock: the actionable Task Surface card above the composer. The
 * projection carries only the active correlation; the inject face loads the
 * authoritative model through getActive and submits or dismisses through the
 * Remote API. Declarative sections and fields render from TaskSurfaceModelV1;
 * conditional fields, uploads, and client fetch stay out of v1.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  TaskSurfaceBlock,
  TaskSurfaceDismissalId,
  TaskSurfaceField,
  TaskSurfaceLayout,
  TaskSurfaceModelV1,
  TaskSurfaceProjection,
  TaskSurfaceSection,
  TaskSurfaceSubmissionId,
} from '@maple/task-surface/client'
import type { PropsLocale } from '@maple/client-ui-slots'
import type { SubmitTaskSurfaceRemoteRequest, TaskSurfaceDockActions } from './slots.ts'
import type { TaskSurfaceKey } from './locales.ts'
import css from './TaskSurfaceDock.module.css'

/** Field id → captured value map submitted through the Remote face. */
type FieldValues = SubmitTaskSurfaceRemoteRequest['values']

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

function assertNever(value: never): never {
  throw new Error(`unexpected Task Surface discriminant: ${JSON.stringify(value)}`)
}

/** Seed editable values from the model; order starts as the declared item ids. */
function initialValues(model: TaskSurfaceModelV1): FieldValues {
  const values: FieldValues = {}
  for (const field of model.fields ?? []) {
    switch (field.kind) {
      case 'text':
        values[field.id] = ''
        break
      case 'choice':
        if (field.multiple) values[field.id] = []
        break
      case 'order':
        values[field.id] = field.items.map(item => item.id)
        break
      default:
        return assertNever(field)
    }
  }
  return values
}

function layoutClass(layout: TaskSurfaceLayout | undefined): string {
  switch (layout) {
    case 'grid-2': return css.grid2
    case 'grid-3': return css.grid3
    case 'stack':
    case undefined:
      return css.stack
    default:
      return assertNever(layout)
  }
}

function renderBlock(block: TaskSurfaceBlock, key: number): ReactNode {
  switch (block.kind) {
    case 'markdown':
      return <div key={key} className={css.markdown}>{block.text}</div>
    case 'metric':
      return (
        <div key={key} className={css.metric}>
          <span className={css.metricLabel}>{block.label}</span>
          <span className={css.metricValue}>{block.value}</span>
          {block.hint !== undefined ? <span className={css.metricHint}>{block.hint}</span> : null}
        </div>
      )
    case 'diff':
      return (
        <div key={key} className={css.diff}>
          <div className={css.diffFilename}>{block.filename}</div>
          <div className={css.diffPanes}>
            <pre className={css.diffPane} data-side="original">{block.original}</pre>
            <pre className={css.diffPane} data-side="modified">{block.modified}</pre>
          </div>
        </div>
      )
    case 'table':
      return (
        <div key={key} className={css.tableWrap}>
          <table className={css.table}>
            <thead>
              <tr>
                {block.headers.map((header, index) => (
                  <th key={index}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    default:
      return assertNever(block)
  }
}

function renderSection(section: TaskSurfaceSection): ReactNode {
  return (
    <section key={section.id} className={css.section} data-section={section.id}>
      {section.title !== undefined ? <h3 className={css.sectionTitle}>{section.title}</h3> : null}
      <div className={layoutClass(section.layout)}>
        {section.blocks.map((block, index) => renderBlock(block, index))}
      </div>
    </section>
  )
}

export interface TaskSurfacePanelProps extends TaskSurfaceDockActions {
  /** Active correlation from the session projection, or null when closed. */
  active: TaskSurfaceProjection['active']
}

/** Presentation panel: declarative model body plus submit/dismiss controls. */
export function TaskSurfacePanel({
  active,
  onGetActive,
  onSubmit,
  onDismiss,
  t,
}: TaskSurfacePanelProps & PropsLocale<'taskSurface'>) {
  const [model, setModel] = useState<TaskSurfaceModelV1 | null>(null)
  const [values, setValues] = useState<FieldValues>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)

  useEffect(() => {
    if (active === null) {
      setModel(null)
      setValues({})
      setError(null)
      return
    }
    let cancelled = false
    void onGetActive().then((result) => {
      if (cancelled) return
      if (result.active && result.surfaceId === active.surfaceId) {
        setModel(result.model)
        setValues(initialValues(result.model))
        setError(null)
      } else {
        setModel(null)
        setValues({})
      }
    })
    return () => { cancelled = true }
  }, [active, onGetActive])

  const setFieldValue = useCallback((id: string, value: FieldValues[string]) => {
    setValues(prev => ({ ...prev, [id]: value }))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (active === null || model === null || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError(null)
    const result = await onSubmit({
      surfaceId: active.surfaceId,
      submissionId: crypto.randomUUID() as TaskSurfaceSubmissionId,
      values,
    })
    pendingRef.current = false
    setPending(false)
    if (!result.accepted) setError(rejectMessage(result.reason, t))
  }, [active, model, onSubmit, t, values])

  const handleDismiss = useCallback(async () => {
    if (active === null || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError(null)
    const result = await onDismiss({
      surfaceId: active.surfaceId,
      dismissalId: crypto.randomUUID() as TaskSurfaceDismissalId,
    })
    pendingRef.current = false
    setPending(false)
    if (!result.dismissed) setError(rejectMessage(result.reason, t))
  }, [active, onDismiss, t])

  if (active === null || model === null) return null

  return (
    <div className={css.dock} data-task-surface-dock aria-label={t('dock.aria')}>
      <div className={css.card}>
        <div className={css.header}>
          <span className={css.title}>{model.title}</span>
          {model.description !== undefined ? (
            <p className={css.description}>{model.description}</p>
          ) : null}
        </div>
        {model.sections.length > 0 ? (
          <div className={css.sections}>
            {model.sections.map(renderSection)}
          </div>
        ) : null}
        {(model.fields?.length ?? 0) > 0 ? (
          <div className={css.fields}>
            {(model.fields ?? []).map(field => (
              <FieldControl
                key={field.id}
                field={field}
                value={values[field.id]}
                disabled={pending}
                t={t}
                onChange={value => setFieldValue(field.id, value)}
              />
            ))}
          </div>
        ) : null}
        <div className={css.bar}>
          {error !== null && <span className={css.error} role="alert">{error}</span>}
          <button
            type="button"
            className={css.dismissBtn}
            disabled={pending}
            onClick={() => { void handleDismiss() }}
          >
            {t('action.dismiss')}
          </button>
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
    </div>
  )
}

interface FieldControlProps {
  field: TaskSurfaceField
  value: FieldValues[string] | undefined
  disabled: boolean
  t: PropsLocale<'taskSurface'>['t']
  onChange: (value: FieldValues[string]) => void
}

function FieldControl({ field, value, disabled, t, onChange }: FieldControlProps): ReactNode {
  switch (field.kind) {
    case 'text':
      return (
        <label className={css.field} data-field={field.id}>
          <span className={css.fieldLabel}>{field.label}</span>
          <input
            type="text"
            className={css.textInput}
            value={typeof value === 'string' ? value : ''}
            placeholder={field.placeholder}
            disabled={disabled}
            required={field.required}
            onChange={event => onChange(event.target.value)}
          />
        </label>
      )
    case 'choice': {
      const multiple = field.multiple === true
      const selectedIds = Array.isArray(value) ? value.map(String) : []
      const selectedId = typeof value === 'string' ? value : null
      return (
        <fieldset className={css.field} data-field={field.id} disabled={disabled}>
          <legend className={css.fieldLabel}>{field.label}</legend>
          <div className={css.options}>
            {field.options.map((option) => {
              const checked = multiple
                ? selectedIds.includes(option.id)
                : selectedId === option.id
              return (
                <label key={option.id} className={css.option}>
                  <input
                    type={multiple ? 'checkbox' : 'radio'}
                    name={field.id}
                    value={option.id}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => {
                      if (multiple) {
                        const next = checked
                          ? selectedIds.filter(id => id !== option.id)
                          : [...selectedIds, option.id]
                        onChange(next)
                      } else {
                        onChange(option.id)
                      }
                    }}
                  />
                  <span className={css.optionBody}>
                    <span className={css.optionLabel}>{option.label}</span>
                    {option.description !== undefined ? (
                      <span className={css.optionDescription}>{option.description}</span>
                    ) : null}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      )
    }
    case 'order': {
      const order = Array.isArray(value) ? value.map(String) : field.items.map(item => item.id)
      const byId = new Map(field.items.map(item => [item.id, item]))
      const move = (index: number, delta: number) => {
        const nextIndex = index + delta
        if (nextIndex < 0 || nextIndex >= order.length) return
        const next = [...order]
        const [item] = next.splice(index, 1)
        if (item === undefined) return
        next.splice(nextIndex, 0, item)
        onChange(next)
      }
      return (
        <fieldset className={css.field} data-field={field.id} disabled={disabled}>
          <legend className={css.fieldLabel}>{field.label}</legend>
          <ol className={css.orderList}>
            {order.map((id, index) => {
              const item = byId.get(id)
              if (item === undefined) return null
              return (
                <li key={id} className={css.orderItem}>
                  <span className={css.optionBody}>
                    <span className={css.optionLabel}>{item.label}</span>
                    {item.description !== undefined ? (
                      <span className={css.optionDescription}>{item.description}</span>
                    ) : null}
                  </span>
                  <span className={css.orderActions}>
                    <button
                      type="button"
                      className={css.orderBtn}
                      disabled={disabled || index === 0}
                      aria-label={t('order.moveUp')}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={css.orderBtn}
                      disabled={disabled || index === order.length - 1}
                      aria-label={t('order.moveDown')}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                  </span>
                </li>
              )
            })}
          </ol>
        </fieldset>
      )
    }
    default:
      return assertNever(field)
  }
}

/** Full props of the dock entry: InputZone owner share + session standard kit + injected verbs + locale seat. */
export type TaskSurfaceDockProps =
  import('@maple/client-ui-slots').PropsRuntime<'conversation.input.dock'>
  & TaskSurfaceDockActions
  & PropsLocale<'taskSurface'>

/** Dock adapter: reads the host-computed taskSurface projection correlation. */
export function TaskSurfaceDock({ useProjection, onGetActive, onSubmit, onDismiss, t }: TaskSurfaceDockProps) {
  const projection = useProjection('taskSurface')
  const active = projection?.active ?? null
  return (
    <TaskSurfacePanel
      active={active}
      onGetActive={onGetActive}
      onSubmit={onSubmit}
      onDismiss={onDismiss}
      t={t}
    />
  )
}
