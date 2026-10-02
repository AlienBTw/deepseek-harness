/**
 * Keyed `show_task_surface` transcript row: a replay-stable summary of the
 * declarative panel published into the chat. Interactive capture stays in the
 * composer dock; this row only presents title and settlement state from the
 * durable call/result slice (and presentationMeta when present).
 */

import { useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconInspectOutline12, IconPanelLeftOutline16, StateDot,
} from '@maple/client-ui-primitives'
import type { ToolCallViewProps } from '@maple/client-ui-tool/client'
import type { PropsLocale } from '@maple/client-ui-slots'
import type { TaskSurfacePresentationMeta } from '@maple/task-surface/client'
import css from './TaskSurfaceRow.module.css'

/** Row lifecycle derived solely from the durable call slice. */
type TaskSurfaceRowState = 'running' | 'ok' | 'error' | 'stopped'

/** Full row props: the toolview runtime share plus this package's locale seat. */
type TaskSurfaceRowProps = ToolCallViewProps & PropsLocale<'taskSurface'>

/** Compact, replay-stable view model for the dedicated row. */
interface TaskSurfaceRowModel {
  readonly title: string
  readonly output: string | null
  readonly errorSummary: string | null
  readonly state: TaskSurfaceRowState
}

/** First physical line for collapsed summaries and malformed-args fallback. */
function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** Title from presentationMeta, then model args, then call id. */
function surfaceTitle(block: ToolCallViewProps['block']): string {
  if ('kind' in block && block.meta !== undefined) {
    const meta = block.meta as TaskSurfacePresentationMeta
    if (meta?.kind === 'dsh/task-surface' && typeof meta.model?.title === 'string' && meta.model.title !== '') {
      return firstLine(meta.model.title)
    }
  }
  const argsRaw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      const model = (parsed as { model?: unknown }).model
      if (typeof model === 'object' && model !== null) {
        const title = (model as { title?: unknown }).title
        if (typeof title === 'string' && title !== '') return firstLine(title)
      }
    }
  } catch {
    // Streaming can expose a truncated JSON prefix; fall through.
  }
  return argsRaw === '' ? block.callId : firstLine(argsRaw)
}

/** Flatten durable result blocks under the generic Tool-row text contract. */
function resultText(block: ToolCallViewProps['block']): string | null {
  if (!('kind' in block)) return null
  const parts: string[] = []
  for (const item of block.content) {
    parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  }
  if (parts.length === 0 && block.error !== undefined) {
    parts.push(`${block.error.name}: ${block.error.code}`)
  }
  return parts.join('\n') || null
}

/** Derive display state without consulting the live taskSurface projection. */
function taskSurfaceRowModel(block: ToolCallViewProps['block']): TaskSurfaceRowModel {
  const settled = 'kind' in block
  const state: TaskSurfaceRowState = !settled
    ? 'running'
    : block.error?.code === 'interrupted'
      ? 'stopped'
      : block.isError ? 'error' : 'ok'
  const output = resultText(block)
  return {
    title: surfaceTitle(block),
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
    state,
  }
}

function leadingFor(state: TaskSurfaceRowState): ReactNode {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    default: return <IconPanelLeftOutline16 size={14} />
  }
}

function disclosureLeading(state: TaskSurfaceRowState, open: boolean, expandable: boolean): ReactNode {
  if (open) return <IconChevronDownOutline14 className={css.chevron} />
  const icon = leadingFor(state)
  if (!expandable) return icon
  return (
    <>
      <span className={css.iconIdle}>{icon}</span>
      <IconChevronDownOutline14 className={`${css.chevron} ${css.chevronHover}`} />
    </>
  )
}

function stateStatus(state: TaskSurfaceRowState, t: TaskSurfaceRowProps['t']): string | null {
  switch (state) {
    case 'running': return t('row.waiting')
    case 'error': return t('row.failed')
    case 'stopped': return t('row.stopped')
    default: return null
  }
}

function collapsedSummary(model: TaskSurfaceRowModel, t: TaskSurfaceRowProps['t']): string {
  if (model.errorSummary !== null) return model.errorSummary
  if (model.state === 'running') return `${model.title} · ${t('row.waiting')}`
  if (model.state === 'ok') return `${model.title} · ${t('row.waiting')}`
  return model.title
}

/**
 * Render one `show_task_surface` tool call as an accent summary row.
 * @param props - keyed toolview payload plus the taskSurface locale seat.
 * @returns the dedicated Task Surface transcript row.
 */
export function TaskSurfaceRow({ block, inspect, t }: TaskSurfaceRowProps) {
  const model = taskSurfaceRowModel(block)
  const [expanded, setExpanded] = useState(false)
  const expandable = model.output !== null
  const open = expanded && expandable
  const status = stateStatus(model.state, t)
  const summary = collapsedSummary(model, t)
  const toggleExpand = (): void => {
    setExpanded(value => !value)
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    toggleExpand()
  }
  const disclosureProps = expandable ? {
    role: 'button' as const,
    tabIndex: 0,
    'aria-expanded': open,
    onClick: toggleExpand,
    onKeyDown: toggleFromKeyboard,
  } : {}
  return (
    <div className={css.card} data-tool="show_task_surface" data-state={model.state}>
      <div
        className={css.row}
        data-expandable={expandable || undefined}
        {...disclosureProps}
      >
        <span className={css.leading}>{disclosureLeading(model.state, open, expandable)}</span>
        {status !== null ? <span className={css.visuallyHidden}>{status}</span> : null}
        <span className={css.title}>{t('row.title')}</span>
        <span className={css.separator} aria-hidden />
        <span className={model.errorSummary === null ? css.summary : `${css.summary} ${css.errorSummary}`}>
          {summary}
        </span>
      </div>
      {open ? (
        <div className={css.bodyWrap}>
          <pre className={css.output} data-error={model.state === 'error' || undefined}>{model.output}</pre>
          {inspect !== undefined ? (
            <button type="button" className={css.inspectButton} onClick={inspect}>
              <IconInspectOutline12 />
              Inspect
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
