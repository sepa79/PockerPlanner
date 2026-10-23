import { useEffect, useState } from 'react'
import { ApiError, type PlannerApi } from '../api/plannerApi'
import type { LinkedSnapshot } from '../api/types'

export interface LinkedRunsDetailsProps {
  api: PlannerApi
  planId: string
  activityIds: string[] | null
  busy?: boolean
}

function journalLink(value: string): string | null {
  try {
    const url = new URL(value)
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href
  } catch {}
  return null
}

export function LinkedRunsDetails({ api, planId, activityIds, busy = false }: LinkedRunsDetailsProps) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<LinkedSnapshot | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setResult(null)
    setError('')
    void api.linkedRuns(planId, controller.signal).then(value => {
      if (!controller.signal.aborted) setResult(value)
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof ApiError && failure.status === 401
        ? 'Sign in with PocketHive to see linked runs.'
        : failure instanceof Error ? failure.message : 'Linked runs could not be loaded.')
    })
    return () => controller.abort()
  }, [open, api, planId])
  const runs = result?.runs.filter(run => activityIds === null || run.activityIds.some(id => activityIds.includes(id)))
  return <details className="pp-linked-runs" open={open} onToggle={event => {
    if (!busy) setOpen(event.currentTarget.open)
  }}>
    <summary aria-disabled={busy} onClick={event => { if (busy) event.preventDefault() }}>PocketHive runs</summary>
    <div className="pp-form-hint" aria-live="polite">
      {error ? <p role="alert">{error}</p> : !result ? <p>Loading linked runs…</p> : <>
        {!runs?.length && <p>No linked runs. Choose this Activity in PocketHive to associate a run.</p>}
        {runs?.map(run => {
          const link = journalLink(run.journalUrl)
          const label = `${run.swarmId} · ${run.runId.slice(0, 8)} · Open PH journal ↗`
          return <p key={`${run.swarmId}/${run.runId}`}>
            {link ? <a href={busy ? undefined : link} aria-disabled={busy} tabIndex={busy ? -1 : undefined} target="_blank" rel="noopener noreferrer">{label}</a> : <span>{label} · Journal link unavailable</span>}
            {run.unresolvedActivityTags.length > 0 && ' · contains references to unavailable Activities'}
          </p>
        })}
        {result.limitReached && <p>Run listing reached PH’s 5,000-run limit; older runs may be missing.</p>}
      </>}
    </div>
  </details>
}
