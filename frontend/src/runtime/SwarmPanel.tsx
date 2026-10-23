import { useEffect, useId, useRef } from 'react'
import type { PlannerApi } from '../api/plannerApi'
import type { ExecutionRun, Plan } from '../api/types'
import { associationNames, canControl, describe, isCurrent, key } from './helpers'
import { commandBusy, useRunCommand } from './useRunCommand'
import './runtime.css'

export interface SwarmPanelProps {
  plan: Plan; run: ExecutionRun | null; outdated: boolean; api: PlannerApi; open: boolean
  onClose: () => void; onRefresh: () => unknown; onBusyChange?: (busy: boolean) => void
}

function journalHref(run: ExecutionRun): string | null {
  try {
    const url = new URL(run.journalUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash
      || url.searchParams.get('runId') !== run.runId || url.searchParams.getAll('runId').length !== 1
      || [...url.searchParams.keys()].some(name => name !== 'runId')) return null
    return run.journalUrl
  } catch { return null }
}

export function SwarmPanel({ plan, run, outdated, api, open, onClose, onRefresh, onBusyChange }: SwarmPanelProps) {
  const { command, begin, retry, check } = useRunCommand(api, plan.id, onRefresh)
  const busy = commandBusy(command)
  const busyCallback = useRef(onBusyChange)
  busyCallback.current = onBusyChange
  const closeCallback = useRef(onClose)
  closeCallback.current = onClose
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  useEffect(() => { busyCallback.current?.(busy) }, [busy])
  useEffect(() => () => { busyCallback.current?.(false) }, [])
  useEffect(() => {
    if (!open) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]')) { event.preventDefault(); closeCallback.current() }
    }
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('keydown', escape)
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [open])

  function submit(action: 'start' | 'stop') {
    if (busy || !run || !canControl(run, outdated, action)) return
    if (action === 'stop' && !window.confirm(`Stop workload in ${run.swarmId}? The swarm remains registered. Activity progress and Started/Done will not change.`)) return
    begin({ planId: plan.id, swarmId: run.swarmId, runId: run.runId, action, idempotencyKey: crypto.randomUUID() })
  }
  const own = Boolean(run && command && key(run) === key(command.request))
  const canRetry = Boolean(own && run && isCurrent(run) && !outdated && !run.runtime!.observationStale
    && (command?.request.action === 'start' ? run.canStart : run.canStop))
  const runtime = run && isCurrent(run) ? run.runtime : null
  const journal = run ? journalHref(run) : null
  const facts: [string, string][] = run ? [
    ['Workload', describe(run, outdated).label], ['Scenario', run.scenarioId || 'Not recorded'], ['Run ID', run.runId],
    ['Linked Activities', associationNames(plan, run).join(', ') || 'Unresolved references'],
  ] : []
  if (runtime) facts.push(['Runtime intent', runtime.runtimeIntent], ['Workload intent', runtime.workloadIntent], ['Controller', runtime.controllerState],
    ['Health', runtime.health], ['Runtime resources', runtime.runtimeResourceState], ['Last observation', runtime.observedAt || 'Not recorded'])
  return <aside className="pp-swarm-panel" hidden={!open} aria-labelledby={titleId}>
    <div className="pp-swarm-heading"><h2 id={titleId}>{run?.swarmId || 'Swarm'}</h2><button type="button" ref={closeRef} onClick={onClose} aria-label="Close swarm panel">×</button></div>
    <div className="pp-swarm-content">
      {!run && <p>This run is no longer in the selected plan's observation. Refresh PH or select another run.</p>}
      {run && <>
        <dl className="pp-swarm-facts">{facts.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
        {outdated && <p className="pp-runtime-warning">Last observation shown; data is outdated and controls are disabled.</p>}
        {runtime?.observationStale && <p className="pp-runtime-warning">Controller observation is stale; Running is not confirmed.</p>}
        {run.unresolvedActivityTags.length > 0 && <p className="pp-runtime-warning">Some linked Activities are unavailable.</p>}
        <h3>Workers · {runtime?.workers.length ?? 0}</h3>
        {runtime?.workers.length ? <table className="pp-swarm-workers"><thead><tr><th scope="col">Worker</th><th scope="col">State</th><th scope="col">Reported TPS</th></tr></thead>
          <tbody>{runtime.workers.map((worker, index) => <tr key={JSON.stringify([worker.instance, worker.role, index])}>
            <td>{worker.role}<small>{worker.instance}</small></td>
            <td>{outdated || runtime.observationStale || worker.stale === true ? 'Stale' : worker.stale !== false ? 'Unknown'
              : worker.enabled === true ? 'Enabled' : worker.enabled === false ? 'Disabled' : 'Unknown'}</td>
            <td>{typeof worker.tps === 'number' && Number.isFinite(worker.tps) && worker.tps >= 0 ? worker.tps : '—'}</td>
          </tr>)}</tbody></table> : <p className="pp-runtime-note">No worker observations reported.</p>}
        {journal ? <a href={journal} target="_blank" rel="noopener noreferrer">Open PH journal ↗</a> : <p className="pp-runtime-warning">A safe HTTP(S) journal link is unavailable.</p>}
        <p className="pp-runtime-note">Linked Activities are associations, not a claim that each phase is running. PP progress and Started/Done stay manual.</p>
      </>}
      <div className="pp-swarm-actions">
        <button type="button" disabled={busy || !canControl(run, outdated, 'start')} onClick={() => submit('start')}>Start</button>
        <button type="button" disabled={busy || !canControl(run, outdated, 'stop')} onClick={() => submit('stop')}>Stop</button>
      </div>
      <div role="status" className="pp-swarm-feedback">{command ? `${own ? '' : `Command for ${command.request.swarmId} / ${command.request.runId}: `}${command.message}`
        : runtime?.activeOperation ? `PH operation pending: ${runtime.activeOperation.type} · ${runtime.activeOperation.correlationId}` : ''}</div>
      {command?.status === 'uncertain' && !command.correlationId && <button type="button" disabled={!canRetry} onClick={() => { if (canRetry) retry() }}>Retry same request</button>}
      {command?.status === 'uncertain' && command.correlationId && <button type="button" onClick={check}>Check outcome</button>}
    </div>
  </aside>
}
