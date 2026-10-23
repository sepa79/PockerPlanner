import { useId, useState } from 'react'
import type { Activity, ExecutionRun, ExecutionSnapshot, Plan } from '../api/types'
import { openBlockers } from '../domain/issues'
import { progress } from '../domain/progress'
import { activityRuns, isCurrent, key, streamRuns } from './helpers'
import { RunBadge } from './RunBadge'
import './runtime.css'

export interface ExecutionRowsProps {
  plan: Plan; snapshot: ExecutionSnapshot | null; outdated: boolean; error: string; pending: boolean; authenticated: boolean
  collapsed: ReadonlySet<string>; onToggleStream: (id: string) => void; onEditActivity: (id: string) => void
  onSelectRun: (run: ExecutionRun) => void
}
const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`
const counts = (runs: ExecutionRun[]): string => `${plural(runs.filter(isCurrent).length, 'current run')}${runs.some(run => !isCurrent(run))
  ? ` · ${plural(runs.filter(run => !isCurrent(run)).length, 'historical run')}` : ''}`

function ManualProgress({ activities }: { activities: Activity[] }) {
  const value = progress(activities)
  return <span className="pp-runtime-progress" title="PP progress · set by the operator">{value === null ? '—' : `${value}%`}</span>
}

export function ExecutionRows(props: ExecutionRowsProps) {
  return <Rows key={props.plan.id} {...props} />
}

function Rows({ plan, snapshot, outdated, error, pending, authenticated, collapsed, onToggleStream, onEditActivity, onSelectRun }: ExecutionRowsProps) {
  const [history, setHistory] = useState(false)
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const groupPrefix = useId()
  function toggleActivity(activityId: string) {
    setFolded(previous => {
      const next = new Set(previous)
      if (next.has(activityId)) next.delete(activityId)
      else next.add(activityId)
      return next
    })
  }
  if (!authenticated) return <div className="pp-runtime">Sign in with PocketHive to see execution. The plan remains public and view-only.</div>
  if (!snapshot) return <div className="pp-runtime" role="status">{error || (pending ? 'Loading PocketHive execution…' : 'No PocketHive observation yet.')}</div>
  const unresolved = snapshot.runs.filter(run => !run.activityIds.some(activityId => plan.activities.some(activity => activity.id === activityId))
    && (history || isCurrent(run)))
  return <div className="pp-runtime" aria-label="PocketHive execution">
    {(outdated || error) && <p className="pp-runtime-warning" role="status">PH unavailable · last observation shown; data is outdated.{error && ` ${error}`}</p>}
    <div className="pp-runtime-options">
      <p className="pp-runtime-note">Linked runs, not active phases · PP progress stays manual</p>
      <label><input type="checkbox" checked={history} onChange={event => setHistory(event.target.checked)} /> Show run history</label>
    </div>
    <div className="pp-runtime-grid pp-runtime-column-head"><span>Stream / Activity / Run</span><span>PocketHive runtime / load</span><span>PP done</span></div>
    {plan.streams.map((stream, streamIndex) => {
      const all = streamRuns(plan, snapshot.runs, stream.id)
      const visible = all.filter(run => history || isCurrent(run))
      const activities = plan.activities.filter(activity => activity.streamId === stream.id)
      const isCollapsed = collapsed.has(stream.id)
      const groupId = `${groupPrefix}-stream-${streamIndex}`
      return <section className="pp-runtime-stream" aria-label={stream.name} key={stream.id}>
        <div className="pp-runtime-stream-heading pp-runtime-grid">
          <button type="button" className="pp-runtime-stream-toggle" onClick={() => onToggleStream(stream.id)} aria-expanded={!isCollapsed} aria-controls={groupId}>
            <span aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span> {stream.name}
          </button>
          <span className="pp-runtime-note">{counts(all)}</span><ManualProgress activities={activities} />
        </div>
        {isCollapsed && <div className="pp-runtime-stream-summary pp-runtime-inline">{visible.map(run => <RunBadge key={key(run)} {...{ plan, run, outdated, onSelectRun }} />)}
          {!visible.length && <span className="pp-runtime-note">No current runs. Enable history to see older links.</span>}
        </div>}
        <div id={groupId} hidden={isCollapsed}>
          {activities.map((activity, activityIndex) => {
            const linked = activityRuns(snapshot.runs, activity.id, history)
            const allLinked = activityRuns(snapshot.runs, activity.id, true)
            const expanded = !folded.has(activity.id)
            const activityGroup = `${groupId}-activity-${activityIndex}`
            const blocked = activity.progress < 100 && openBlockers(plan, activity).length > 0
            return <article className="pp-runtime-activity" key={activity.id} data-activity-id={activity.id}>
              <div className="pp-runtime-activity-heading pp-runtime-grid">
                <div className="pp-runtime-activity-label">
                  <button type="button" className="pp-runtime-fold" disabled={!linked.length} onClick={() => toggleActivity(activity.id)}
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} runs for ${activity.name}`} aria-expanded={expanded} aria-controls={activityGroup}>{expanded ? '▾' : '▸'}</button>
                  <button type="button" className="pp-runtime-activity-name" onClick={() => onEditActivity(activity.id)}>{activity.name}</button>
                </div>
                <div className="pp-runtime-note">{linked.length ? `${counts(allLinked)} · Phase not recorded` : allLinked.length
                  ? `${plural(allLinked.length, 'historical run')} hidden` : 'No linked runs'}{blocked && <span className="pp-runtime-warning"> · Plan blocked</span>}</div>
                <ManualProgress activities={[activity]} />
              </div>
              <div id={activityGroup} hidden={!expanded}>{linked.map((run, runIndex) => <div className="pp-runtime-run-row pp-runtime-grid" key={key(run)}>
                <span className="pp-runtime-note">↳ Run {runIndex + 1}</span><div className="pp-runtime-inline"><RunBadge {...{ plan, run, outdated, onSelectRun }} /></div><span />
              </div>)}</div>
            </article>
          })}
          {!activities.length && <p className="pp-runtime-note">No Activities in this Stream.</p>}
        </div>
      </section>
    })}
    {!plan.streams.length && <p>No Streams in this plan.</p>}
    {unresolved.length > 0 && <section><h3>Unresolved Activity references</h3><div className="pp-runtime-inline">
      {unresolved.map(run => <RunBadge key={key(run)} {...{ plan, run, outdated, onSelectRun }} />)}
    </div></section>}
    {snapshot.limitReached && <p className="pp-runtime-note">PH reached the 5,000-run listing limit; older runs may be missing.</p>}
  </div>
}
