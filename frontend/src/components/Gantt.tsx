import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { Activity, Plan } from '../api/types'
import { addDays, dateAt, dayDiff, frame, isWeekend, workingStart, type Forecast, type Frame, type Schedule } from '../domain/schedule'
import { openBlockers, streamBlockers } from '../domain/issues'
import { progress } from '../domain/progress'

export interface GanttProps {
  plan: Plan; forecast: Forecast; today: string; start: string; days: number; canEdit: boolean; busy: boolean; whatIf: boolean
  collapsed: ReadonlySet<string>; onToggleStream: (id: string) => void; onEditActivity: (id: string) => void; onEditStream: (id: string) => void
  onMove: (id: string, start: string) => Promise<void>; onDragging: (dragging: boolean) => void
  mixed?: (target: { streamId?: string; activityId?: string }) => React.ReactNode
}

export function shortDate(day: string) { return dateAt(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) }

function FrameContents({ value, color }: { value: Frame; color?: string }) {
  return <>
    {value.work.map((segment, index) => <span key={`work-${index}`} className="pp-bar-fill" style={{ left: `${segment.offset / value.durationDays * 100}%`, width: `${segment.durationDays * segment.progress / 100 / value.durationDays * 100}%`, background: color }} />)}
    {value.gaps.map((gap, index) => <span key={`gap-${index}`} className={`pp-bar-gap pp-${gap.kind}${gap.weekend ? ' pp-blocked-weekend' : ''}`} title={gap.kind === 'pause' ? 'Blocker / waiting period' : gap.kind === 'weekend' ? 'Weekend · no work planned' : 'No scheduled work'}
      style={{ left: `${gap.offset / value.durationDays * 100}%`, width: `${gap.durationDays / value.durationDays * 100}%` }} />)}
  </>
}

export function Gantt(props: GanttProps) {
  const { plan, forecast, today, start, days, collapsed } = props
  const root = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  useLayoutEffect(() => {
    const element = root.current!
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    setWidth(element.clientWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const labelWidth = width < 600 ? 155 : 230
  const trackWidth = Math.max(220, width - labelWidth)
  const dayWidth = trackWidth / days
  const todayOffset = dayDiff(start, today)
  const deadlineOffset = plan.deadline ? dayDiff(start, plan.deadline) : -1
  const stride = Math.max(1, Math.ceil(23 / dayWidth))
  const decorations = <>
    {Array.from({ length: days }, (_, offset) => isWeekend(addDays(start, offset)) ? <span key={offset} className="pp-track-weekend" style={{ left: `${offset / days * 100}%`, width: `${100 / days}%` }} /> : null)}
    {todayOffset >= 0 && todayOffset < days ? <span className="pp-today-line" style={{ left: `${(todayOffset + .5) / days * 100}%` }} /> : null}
    {deadlineOffset >= 0 && deadlineOffset < days ? <span className="pp-deadline-line" title={`Deadline ${plan.deadline}`} style={{ left: `${(deadlineOffset + 1) / days * 100}%` }} /> : null}
  </>
  return <div ref={root} className={`pp-gantt${props.whatIf ? ' pp-whatif-active' : ''}`} aria-label="Interactive calendar Gantt chart">
    <div className="pp-gantt-inner" style={{ '--label-width': `${labelWidth}px`, '--day-width': `${dayWidth}px`, minWidth: labelWidth + trackWidth } as CSSProperties}>
      <div className="pp-gantt-row pp-gantt-heading"><div className="pp-row-label">Stream / activity</div><div className="pp-track pp-calendar-days">
        {Array.from({ length: days }, (_, offset) => {
          const day = addDays(start, offset)
          const weekday = dateAt(day).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
          const labelled = offset === todayOffset || offset % stride === 0 && (todayOffset < 0 || todayOffset >= days || Math.abs(offset - todayOffset) >= stride)
          return <span key={day} className={`pp-calendar-day${day === today ? ' pp-today' : ''}${isWeekend(day) ? ' pp-weekend-day' : ''}`} style={{ width: `${100 / days}%` }} title={`${day} · ${weekday}`}>
            {dayWidth >= 28 ? weekday : ''}<strong>{labelled ? dateAt(day).getUTCDate() : ''}</strong>
          </span>
        })}
      </div></div>
      {plan.streams.map(stream => {
        const blocked = streamBlockers(plan, stream.id).length > 0
        const items = plan.activities.filter(item => item.streamId === stream.id).sort((first, second) => forecast.projected.activities.get(first.id)!.start!.localeCompare(forecast.projected.activities.get(second.id)!.start!))
        const summary = forecast.projected.streams.get(stream.id)!
        const overall = progress(items)
        const summaryFrame = collapsed.has(stream.id) ? frame(summary, start, days, overall ?? 0) : null
        return <Fragment key={stream.id}>
          <div className={`pp-gantt-row pp-stream-group${blocked ? ' pp-blocked-stream' : ''}`}>
            <div className="pp-row-label"><button type="button" className="pp-stream-toggle" aria-label={`${collapsed.has(stream.id) ? 'Expand' : 'Collapse'} ${stream.name}`} aria-expanded={!collapsed.has(stream.id)} onClick={() => props.onToggleStream(stream.id)} title={stream.description}>
              <span aria-hidden="true">{collapsed.has(stream.id) ? '▸' : '▾'}</span><span>{stream.name}{stream.dependsOn ? ' ↳' : ''}{blocked ? ' ◇' : ''}</span>
            </button><span className="pp-stream-progress" aria-label={`${stream.name} overall progress: ${overall === null ? 'no activities' : overall + '%'}`}>{overall === null ? '—' : `${overall}%`}</span>
              <button className="pp-stream-edit" aria-label={`Edit ${stream.name}`} onClick={() => props.onEditStream(stream.id)}>✎</button></div>
            <div className="pp-track">{decorations}{summaryFrame ? <div className="pp-stream-summary" style={position(summaryFrame, days)} title={`${stream.name} · ${items.length} activities · ${overall}% overall`}><FrameContents value={summaryFrame} /><span className="pp-bar-label">{stream.name}</span></div> : null}</div>
          </div>
          {collapsed.has(stream.id) ? props.mixed?.({ streamId: stream.id }) : items.map(item => {
            const schedule = forecast.projected.activities.get(item.id)!
            const estimate = forecast.baseline.activities.get(item.id)!
            const blockers = item.progress < 100 ? openBlockers(plan, item) : []
            const overdue = item.progress < 100 && Boolean(estimate.end && estimate.end < today)
            const type = plan.activityTypes.find(candidate => candidate.id === item.typeId)!
            const automatic = Boolean(item.dependsOn || stream.dependsOn)
            const title = `${item.name} · ${type.name} · Forecast ${schedule.start} – ${schedule.end} · ${item.durationDays} full planned ${item.includeWeekends ? 'calendar' : 'working'} days · ${blockers.length} open blockers${overdue ? ' · Past estimated finish' : ''}`
            return <Fragment key={item.id}><div className={`pp-gantt-row pp-activity-row${blockers.length ? ' pp-blocked-stream' : ''}`}>
              <div className="pp-row-label"><button className="pp-activity-name" style={{ paddingLeft: 10 + dependencyDepth(plan, item) * 16 }} onClick={() => props.onEditActivity(item.id)} title={title}>{item.name}{automatic ? ' ↳' : ''}</button><span className={blockers.length || overdue ? 'pp-warning-text' : ''}>{item.progress}%{blockers.length ? ' ◇' : overdue ? ' !' : ''}</span></div>
              <div className="pp-track">{decorations}<ActivityBar activity={item} schedule={schedule} start={start} days={days} title={title} color={type.color} automatic={automatic} dayWidth={dayWidth}
                enabled={props.canEdit && !props.busy && !props.whatIf} onEdit={() => props.onEditActivity(item.id)} onMove={props.onMove} onDragging={props.onDragging} /></div>
            </div>{props.mixed?.({ activityId: item.id })}</Fragment>
          })}
        </Fragment>
      })}
      {!plan.streams.length ? <div className="pp-empty">No streams yet. Create a plan or import a workspace from Data.</div> : null}
    </div>
  </div>
}

function position(value: Frame, days: number): CSSProperties { return { left: `calc(${value.offset / days * 100}% + 2px)`, width: `calc(${value.durationDays / days * 100}% - 4px)` } }

function dependencyDepth(plan: Plan, item: Activity) {
  let depth = 0
  let current = item.dependsOn
  while (current) { depth++; current = plan.activities.find(activity => activity.id === current)?.dependsOn }
  return depth
}

function ActivityBar({ activity, schedule, start, days, title, color, automatic, dayWidth, enabled, onEdit, onMove, onDragging }: {
  activity: Activity; schedule: Schedule; start: string; days: number; title: string; color: string; automatic: boolean; dayWidth: number; enabled: boolean
  onEdit: () => void; onMove: (id: string, start: string) => Promise<void>; onDragging: (value: boolean) => void
}) {
  const value = frame(schedule, start, days, activity.progress)
  const [offset, setOffset] = useState(0)
  const drag = useRef<{ pointer: number; start: number; moved: boolean } | null>(null)
  const ignoreClick = useRef(false)
  const callback = useRef(onDragging)
  callback.current = onDragging
  useEffect(() => () => { if (drag.current) callback.current(false) }, [])
  if (!value) return null
  function begin(event: PointerEvent<HTMLButtonElement>) {
    if (!enabled || automatic || schedule.recordedCompletion || event.button !== 0) return
    drag.current = { pointer: event.pointerId, start: event.clientX, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
    onDragging(true)
  }
  function cancel() { if (!drag.current) return; drag.current = null; setOffset(0); onDragging(false) }
  async function finish(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current) return
    drag.current = null
    const shift = Math.round((event.clientX - current.start) / dayWidth)
    setOffset(0)
    if (current.moved || shift) { ignoreClick.current = true; setTimeout(() => { ignoreClick.current = false }, 100) }
    try {
      if (shift && schedule.start) {
        const next = workingStart(addDays(schedule.start, shift), activity.includeWeekends === true)
        if (next !== activity.start) await onMove(activity.id, next)
      }
    } finally { onDragging(false) }
  }
  return <button className={`pp-bar${activity.startedAt ? '' : ' pp-tentative'}${automatic ? ' pp-dependent' : ''}`} type="button" style={{ ...position(value, days), '--bar-color': color, transform: `translateX(${offset}px)` } as CSSProperties}
    title={title} aria-label={title} data-activity-id={activity.id} data-start={schedule.start} data-end={schedule.end} onClick={() => { if (!ignoreClick.current) onEdit() }}
    onPointerDown={begin} onPointerMove={event => { if (drag.current) { const distance = event.clientX - drag.current.start; drag.current.moved ||= Math.abs(distance) > 3; setOffset(distance) } }}
    onPointerUp={event => { void finish(event) }} onPointerCancel={cancel} onLostPointerCapture={cancel}>
    <FrameContents value={value} color={color} /><span className="pp-bar-label">{activity.name}</span><span className="pp-bar-progress">{value.durationDays * dayWidth > 35 ? `${activity.progress}%` : ''}</span>
  </button>
}
