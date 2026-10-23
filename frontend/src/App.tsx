import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePocketAuth } from '@pockethive/browser-auth'
import { AppHeader, AppShell } from '@pockethive/ui'
import { useLocation, useNavigate } from 'react-router-dom'
import { createPlannerApi } from './api/plannerApi'
import type { EditorKind, EditorSave, EditorSelection, ExecutionRun, Plan, PlannerTab, ViewMode } from './api/types'
import { BlockedAlert } from './components/BlockedAlert'
import { Editor } from './components/Editor'
import { Gantt, shortDate } from './components/Gantt'
import { IdentityButton } from './components/IdentityButton'
import { WhatIfControls, type Assumption } from './components/WhatIfControls'
import { WorkspaceNavigation } from './components/WorkspaceNavigation'
import { issueAffects, openBlockers } from './domain/issues'
import { progress } from './domain/progress'
import { addDays, dayDiff, finish, forecast } from './domain/schedule'
import { useToday } from './hooks/useToday'
import { message, useWorkspace } from './hooks/useWorkspace'
import { ExecutionRows, MixedRuns, SwarmPanel, useExecution } from './runtime'
import './runtime/runtime.css'
import { CollectionsView } from './views/CollectionsView'
import { DataView } from './views/DataView'
import { IssuesView } from './views/IssuesView'

const EMPTY_PLAN: Plan = { id: '', name: '', description: '', streams: [], activityTypes: [], activities: [], issues: [] }
const TABS: Record<ViewMode, PlannerTab[]> = { plan: ['plan', 'issues', 'streams', 'types', 'data', 'plans'], execution: ['plan', 'issues'], mixed: ['plan', 'issues', 'streams'] }
const LABELS: Record<PlannerTab, string> = { plan: 'Plan', issues: 'Issues', streams: 'Streams', types: 'Types', data: 'Data', plans: 'Plans' }

export function App() {
  const [notice, setNotice] = useState('')
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const notify = useCallback((value: string) => { setNotice(value); clearTimeout(noticeTimer.current); noticeTimer.current = setTimeout(() => setNotice(''), 6000) }, [])
  useEffect(() => () => clearTimeout(noticeTimer.current), [])
  const authError = useCallback((failure: unknown) => notify(message(failure)), [notify])
  const auth = usePocketAuth({ storageKey: 'POCKETPLANNER_AUTH_SESSION', onError: authError })
  const api = useMemo(() => createPlannerApi(auth.fetchWithAuth), [auth.fetchWithAuth])
  const [editor, setEditor] = useState<EditorSelection | null>(null)
  const [dragging, setDragging] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const interaction = useRef(false)
  interaction.current = Boolean(editor) || dragging || importBusy
  const locked = useCallback(() => interaction.current, [])
  const closeConflict = useCallback(() => setEditor(null), [])
  const workspace = useWorkspace(api, locked, notify, closeConflict)
  const busy = workspace.busy || importBusy
  const today = useToday(Boolean(editor) || busy || dragging)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = workspace.document?.plans.find(plan => plan.id === selectedId) ?? workspace.document?.plans[0] ?? null
  const plan = selected ?? EMPTY_PLAN
  const [mode, setMode] = useState<ViewMode>('plan')
  const [expanded, setExpanded] = useState(() => sessionStorage.getItem('PP_UI_NAV') === 'expanded')
  const [collapsedPlans, setCollapsedPlans] = useState<Map<string, Set<string>>>(new Map())
  const collapsed = collapsedPlans.get(plan.id) ?? new Set<string>()
  const [timelineStart, setTimelineStart] = useState<string | null>(null)
  const [visibleDays, setVisibleDays] = useState(() => window.innerWidth < 600 ? 7 : 21)
  const [assumption, setAssumption] = useState<Assumption | null>(null)
  const [blockersOnly, setBlockersOnly] = useState(false)
  const [historicalIssues, setHistoricalIssues] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [selectedRun, setSelectedRun] = useState<ExecutionRun | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [commandBusy, setCommandBusy] = useState(false)
  const identity = useRef({ user: auth.session.user, epoch: 0 })
  if (identity.current.user !== auth.session.user) identity.current = { user: auth.session.user, epoch: identity.current.epoch + 1 }
  const identityKey = auth.session.user ? `${auth.session.user.username}:${identity.current.epoch}` : null
  const navigate = useNavigate()
  const requestedTab = useLocation().pathname.slice(1) as PlannerTab
  const tab = TABS[mode].includes(requestedTab) ? requestedTab : 'plan'
  const execution = useExecution({ api, planId: selected?.id ?? null, identityKey, enabled: (mode !== 'plan' && tab === 'plan') || panelOpen || commandBusy })
  const normal = useMemo(() => forecast(plan, today, issueAffects), [plan, today])
  const projected = useMemo(() => {
    try { return { value: assumption ? forecast(plan, today, issueAffects, assumption) : normal, error: '' } }
    catch (failure) { return { value: null, error: message(failure) } }
  }, [plan, today, assumption, normal])
  const defaultStart = addDays([today, ...[...normal.projected.activities.values()].map(value => value.start)].filter((value): value is string => Boolean(value)).sort()[0], -2)
  const start = timelineStart ?? defaultStart
  useEffect(() => { if (timelineStart === null && selected) setTimelineStart(defaultStart) }, [timelineStart, selected, defaultStart])
  useEffect(() => { if (requestedTab !== tab) void navigate(`/${tab}`, { replace: true }) }, [requestedTab, tab, navigate])
  useEffect(() => { workspace.flush() }, [editor, dragging, importBusy, workspace.flush])
  useEffect(() => { if (!auth.session.canEdit && !workspace.busy) setEditor(null) }, [auth.session.canEdit, workspace.busy])
  useEffect(() => { setAssumption(null); setAcknowledged(false); setTimelineStart(null) }, [plan.id])
  useEffect(() => { setPanelOpen(false); setSelectedRun(null); setCommandBusy(false) }, [plan.id, identityKey])
  useEffect(() => {
    if (selectedId && !workspace.document?.plans.some(item => item.id === selectedId) && workspace.document) {
      setSelectedId(selected?.id ?? null)
      notify('Selected plan was removed. Showing the current workspace.')
    }
  }, [workspace.document, selectedId, selected, notify])

  function selectPlan(id: string) { if (!busy && !dragging) { setSelectedId(id); setTimelineStart(null); setAcknowledged(false); setAssumption(null) } }
  function toggleStream(id: string) {
    setCollapsedPlans(previous => { const next = new Map(previous); const folded = new Set(next.get(plan.id)); folded.has(id) ? folded.delete(id) : folded.add(id); next.set(plan.id, folded); return next })
  }
  function openEditor(kind: EditorKind, id: string | null = null) {
    if (!workspace.document || busy || dragging || !id && !auth.session.canEdit) return
    if (kind !== 'plan' && !selected) { navigate('/plans'); notify('Create a plan first'); return }
    if (kind === 'activity' && (!plan.streams.length || !plan.activityTypes.length)) { notify('Add a stream and an activity type first.'); return }
    setEditor({ kind, id, planId: selected?.id ?? null, workspace: structuredClone(workspace.document) })
  }
  async function saveEditor(payload: EditorSave) {
    const createdPlan = editor?.kind === 'plan' && editor.id === null && payload.endpoint === 'state'
      ? payload.document.plans.find(item => !editor.workspace.plans.some(previous => previous.id === item.id))
      : undefined
    await workspace.persist(payload)
    if (createdPlan) setSelectedId(createdPlan.id)
    setEditor(null)
  }
  async function moveActivity(id: string, nextStart: string) {
    if (!workspace.document || !auth.session.canEdit) return
    const draft = structuredClone(workspace.document)
    draft.plans.find(item => item.id === plan.id)!.activities.find(item => item.id === id)!.start = nextStart
    try { await workspace.persist({ endpoint: 'state', document: draft }) } catch (failure) { notify(message(failure)) }
  }
  function selectRun(run: ExecutionRun) { setSelectedRun(run); setPanelOpen(true) }
  const observedRun = selectedRun && execution.snapshot ? execution.snapshot.runs.find(run => run.swarmId === selectedRun.swarmId && run.runId === selectedRun.runId) ?? null : null
  const remaining = plan.activities.filter(item => item.progress < 100)
  const blocked = remaining.filter(item => openBlockers(plan, item).length > 0)
  const overdue = remaining.filter(item => (normal.baseline.activities.get(item.id)?.end ?? today) < today).length
  const forecastFinish = projected.value ? finish(projected.value.projected) : null
  const margin = plan.deadline && forecastFinish ? dayDiff(forecastFinish, plan.deadline) : null
  const navLocked = busy || dragging
  const modeTitle = mode === 'execution' ? 'Swarms' : mode === 'mixed' ? 'Overview' : 'Plan'
  return <>
    <AppShell navigationExpanded={expanded}
      header={<AppHeader leading={<div className="pp-brand"><img src="/pocketplanner-topbar.svg" alt="PocketPlanner" /><span className="pp-version">{workspace.version}</span><span className={`pp-live pp-live-${workspace.live}`} role="status" title="Automatic updates from other sessions">{{ live: 'Live', connecting: 'Connecting…', pending: 'Update waiting', unavailable: 'Live updates unavailable' }[workspace.live]}</span></div>} center={null}
        trailing={<><select aria-label="Active plan" value={selected?.id ?? ''} disabled={navLocked || Boolean(editor)} onChange={event => selectPlan(event.target.value)}>{workspace.document?.plans.length ? workspace.document.plans.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">No plans</option>}</select><span className="pp-today-label">{shortDate(today)}</span>
          <IdentityButton username={auth.session.user?.username ?? null} configured={auth.session.configured} loading={auth.loading} signingIn={auth.signingIn} locked={navLocked} signIn={auth.signIn} signOut={auth.signOut} cancelSignIn={auth.cancelSignIn} />
          {auth.session.canEdit && mode !== 'execution' ? <button className="pp-primary pp-add-activity" disabled={navLocked} onClick={() => openEditor('activity')}>＋ Activity</button> : null}</>} />}
      navigation={<WorkspaceNavigation mode={mode} expanded={expanded} locked={navLocked} onExpandedChange={value => { setExpanded(value); sessionStorage.setItem('PP_UI_NAV', value ? 'expanded' : 'collapsed') }} onModeChange={value => { setMode(value); navigate('/plan') }} />}
      toolbar={<div className="pp-navigation"><nav role="tablist" aria-label="Planner views" onKeyDown={event => {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
        const index = buttons.indexOf(event.target as HTMLButtonElement)
        if (navLocked || index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next].click(); buttons[next].focus()
      }}>{TABS[mode].map(value => <button role="tab" key={value} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} disabled={navLocked} onClick={() => navigate(`/${value}`)}>{value === 'plan' ? modeTitle : LABELS[value]}{value === 'issues' ? <span className="pp-count">{plan.issues.filter(issue => issue.open).length}</span> : null}</button>)}</nav>
        <div className="pp-stats" aria-label="Plan statistics">{[['Activities', plan.activities.length], ['Progress', `${progress(plan.activities) ?? 0}%`], ['Blocked', blocked.length], ['Overdue', overdue]].map(([label, value]) => <span key={label}><strong>{value}</strong>{label}</span>)}</div>
      </div>}>
      {auth.signingIn || auth.confirmationUrl && auth.error?.code === 'popup_blocked' ? <div className="pp-auth-status" role="status"><span>{auth.signingIn ? 'Confirm sign-in in the PocketHive tab.' : 'Open PocketHive to confirm shared sign-out.'}</span><button onClick={auth.openConfirmation}>Open PocketHive</button></div> : null}
      {auth.error ? <p className="pp-error" role="alert">{auth.error.message}</p> : null}
      {workspace.error ? <div className="pp-error" role="alert">{workspace.error}<button onClick={() => { void workspace.reload().catch(failure => notify(message(failure))) }}>Retry</button></div> : null}
      {!workspace.document ? <p className="pp-empty">Loading workspace…</p> : <>
        {tab === 'plan' ? <section className="pp-plan-panel" aria-label={modeTitle}>
          {mode !== 'plan' ? <div className="pp-runtime-toolbar"><span role="status">{!auth.session.user ? 'Sign in to view execution' : execution.error ? `PH unavailable · ${execution.error}` : execution.outdated ? 'PH observation outdated' : execution.pending ? 'Loading PH…' : execution.snapshot ? `Live PH · ${new Date(execution.snapshot.fetchedAt).toLocaleTimeString('en-GB')}` : 'No PH observation yet'}</span><button onClick={() => { void execution.refresh() }} disabled={execution.pending || !auth.session.user}>Refresh PH</button></div> : null}
          {mode === 'execution' ? <ExecutionRows plan={plan} snapshot={execution.snapshot} outdated={execution.outdated} error={execution.error} pending={execution.pending} authenticated={Boolean(auth.session.user)} collapsed={collapsed} onToggleStream={toggleStream} onEditActivity={id => openEditor('activity', id)} onSelectRun={selectRun} /> : <>
            <div className="pp-plan-toolbar"><div className="pp-actions"><button aria-label="Previous range" disabled={navLocked} onClick={() => setTimelineStart(addDays(start, -visibleDays))}>‹</button><strong className="pp-range-label">{shortDate(start)} – {shortDate(addDays(start, visibleDays - 1))} {dateAtYear(addDays(start, visibleDays - 1))}</strong><button aria-label="Next range" disabled={navLocked} onClick={() => setTimelineStart(addDays(start, visibleDays))}>›</button><button disabled={navLocked} onClick={() => setTimelineStart(addDays(today, -2))}>Today</button><select aria-label="Visible calendar days" value={visibleDays} disabled={navLocked} onChange={event => setVisibleDays(Number(event.target.value))}>{[7, 14, 21, 28].map(value => <option key={value} value={value}>{value} days</option>)}</select></div>
              <div className="pp-legend"><span>│ Today</span><span>▱ Planned</span><span>▰ Weekend</span><span>▰ Pause</span><span>┆ Deadline</span></div>{auth.session.canEdit ? <button className="pp-primary pp-mobile-add" disabled={navLocked} onClick={() => openEditor('activity')}>＋ Activity</button> : null}<button disabled={!selected || navLocked || !plan.issues.some(issue => issue.open && issue.blocker)} aria-expanded={Boolean(assumption)} onClick={() => setAssumption(assumption ? null : { issueId: plan.issues.find(issue => issue.open && issue.blocker)!.id, endDate: today })}>{assumption ? 'Return to plan' : 'What if?'}</button>
            </div>
            {assumption ? <WhatIfControls issues={plan.issues} today={today} value={assumption} onChange={setAssumption} /> : null}
            <div className="pp-plan-summary"><span>Deadline <strong>{plan.deadline ? shortDate(plan.deadline) : 'Not set'}</strong></span><span>Forecast finish <strong>{forecastFinish ? shortDate(forecastFinish) : 'No activities'}</strong></span>{assumption ? <span className="pp-preview-label">What if · {projected.value?.changed.size ?? 0} activities changed · nothing saved</span> : null}<span className={margin !== null && margin < 0 ? 'pp-warning-text' : ''}>{margin === null ? 'No deadline comparison' : margin < 0 ? `${-margin} calendar days past deadline` : margin === 0 ? 'On deadline' : `${margin} calendar days of margin`}</span></div>
            {projected.error ? <p className="pp-error" role="alert">{projected.error}</p> : projected.value ? <Gantt plan={plan} forecast={projected.value} today={today} start={start} days={visibleDays} canEdit={auth.session.canEdit} busy={navLocked} whatIf={Boolean(assumption)} collapsed={collapsed} onToggleStream={toggleStream} onEditActivity={id => openEditor('activity', id)} onEditStream={id => openEditor('stream', id)} onMove={moveActivity} onDragging={setDragging}
              mixed={mode === 'mixed' ? target => <MixedRuns plan={plan} runs={execution.snapshot?.runs ?? []} outdated={execution.outdated} {...target} onSelectRun={selectRun} /> : undefined} /> : null}
            <p className="pp-timeline-hint">Red: pause · Grey: non-working weekend · {assumption ? 'Assumed blocker end; nothing saved' : 'Open blockers last through today; forecast resumes no earlier than tomorrow · Click details; drag to reschedule'}</p>
          </>}
        </section> : tab === 'issues' ? <IssuesView key={plan.id} plan={plan} canEdit={auth.session.canEdit} busy={busy} blockersOnly={blockersOnly} setBlockersOnly={setBlockersOnly} historical={historicalIssues} setHistorical={setHistoricalIssues} onEdit={id => openEditor('issue', id)} onNew={() => openEditor('issue')} />
          : tab === 'data' ? <DataView workspace={workspace.document} selected={selected} canEdit={auth.session.canEdit} busy={workspace.busy} onBusyChange={setImportBusy} onSave={workspace.persist} />
            : <CollectionsView tab={tab} workspace={workspace.document} plan={selected} canEdit={auth.session.canEdit} busy={busy} onEdit={openEditor} onSelect={id => { selectPlan(id); navigate('/plan') }} />}
      </>}
    </AppShell>
    {editor ? <Editor selection={editor} canEdit={auth.session.canEdit} busy={workspace.busy} api={api} onClose={() => { if (!workspace.busy) setEditor(null) }} onSave={saveEditor} /> : null}
    <SwarmPanel key={`${plan.id}:${identityKey}`} plan={plan} run={observedRun} open={panelOpen} outdated={execution.outdated} api={api} onClose={() => setPanelOpen(false)} onRefresh={execution.refresh} onBusyChange={setCommandBusy} />
    <BlockedAlert open={blocked.length > 0 && blocked.length === remaining.length && !acknowledged} onAcknowledge={() => setAcknowledged(true)} onShow={() => { setAcknowledged(true); setBlockersOnly(true); setHistoricalIssues(false); navigate('/issues') }} />
    {notice ? <div className="pp-notice" role="status" aria-live="polite">{notice}</div> : null}
  </>
}

function dateAtYear(day: string) { return Number(day.slice(0, 4)) }
