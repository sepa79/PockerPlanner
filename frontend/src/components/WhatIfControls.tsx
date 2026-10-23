import type { Issue } from '../api/types'
import { addDays } from '../domain/schedule'

export interface Assumption { issueId: string; endDate: string }

export function WhatIfControls({ issues, today, value, onChange }: { issues: Issue[]; today: string; value: Assumption; onChange: (value: Assumption) => void }) {
  const blockers = issues.filter(issue => issue.open && issue.blocker)
  function shift(amount: number) {
    const next = addDays(value.endDate, amount)
    if (next >= today && next <= addDays(today, 365)) onChange({ ...value, endDate: next })
  }
  return <div className="pp-whatif-panel" aria-label="What if blocker end date">
    {blockers.length ? <>
      <label>Blocker<select aria-label="What if blocker" value={value.issueId} onChange={event => onChange({ ...value, issueId: event.target.value })}>{blockers.map(issue => <option key={issue.id} value={issue.id}>{issue.title}</option>)}</select></label>
      <label>Blocked through<div className="pp-duration-stepper"><button type="button" onClick={() => shift(-1)} disabled={value.endDate <= today} aria-label="One day earlier">−</button>
        <input type="date" value={value.endDate} min={today} max={addDays(today, 365)} aria-label="Assumed blocker end date" onChange={event => onChange({ ...value, endDate: event.target.value })} />
        <button type="button" onClick={() => shift(1)} disabled={value.endDate >= addDays(today, 365)} aria-label="One day later">+</button></div></label>
      <p className="pp-muted">Assumption only · nothing saved</p>
    </> : <p className="pp-muted">No active blockers.</p>}
  </div>
}
