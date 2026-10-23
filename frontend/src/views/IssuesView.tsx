import type { Plan } from '../api/types'
import { issueAffects } from '../domain/issues'
import { shortDate } from '../components/Gantt'

export function IssuesView({ plan, canEdit, busy, blockersOnly, setBlockersOnly, historical, setHistorical, onEdit, onNew }: {
  plan: Plan; canEdit: boolean; busy: boolean; blockersOnly: boolean; setBlockersOnly: (value: boolean) => void
  historical: boolean; setHistorical: (value: boolean) => void
  onEdit: (id: string) => void; onNew: () => void
}) {
  const visible = plan.issues.filter(issue => issue.open !== historical && (!blockersOnly || issue.blocker))
  return <section className="pp-panel" aria-label="Issues"><div className="pp-panel-toolbar"><h2>Issues</h2><div className="pp-actions">
    <select aria-label="Issue status filter" value={historical ? 'historical' : 'active'} onChange={event => setHistorical(event.target.value === 'historical')} disabled={busy}><option value="active">Active</option><option value="historical">Historical</option></select>
    <button type="button" onClick={() => setBlockersOnly(!blockersOnly)} disabled={busy}>{blockersOnly ? 'Blockers only' : 'All issues'}</button>
    {canEdit ? <button className="pp-primary" disabled={busy} onClick={onNew}>＋ Issue</button> : null}
  </div></div><div className="pp-panel-body">
    {visible.map(issue => {
      const activities = plan.activities.filter(activity => issueAffects(issue, activity))
      const streams = [...new Set(activities.map(activity => plan.streams.find(stream => stream.id === activity.streamId)?.name))].filter(Boolean)
      const scope = issue.scope === 'ALL' ? 'ALL' : issue.scope === 'STREAMS' ? issue.streamIds.map(id => plan.streams.find(stream => stream.id === id)?.name).join(', ') : activities.length ? `${activities.length} activities` : 'No activities'
      return <article key={issue.id} className={`pp-issue${issue.open && issue.blocker ? ' pp-blocking-issue' : ''}`}>
        <div className="pp-issue-labels"><span className={`pp-issue-kind${issue.blocker ? ' pp-blocker' : ''}`}>{issue.blocker ? 'Blocker' : 'Issue'}</span><span>{scope}</span></div>
        <div className="pp-issue-main"><div className="pp-issue-top"><button className="pp-text-button pp-issue-title" disabled={busy} onClick={() => onEdit(issue.id)}>{issue.title}</button><div className="pp-actions">
          {!issue.open ? <span className="pp-badge">Closed</span> : null}{issue.descriptionIncomplete ? <span className="pp-incomplete" title="The description is missing details; this label does not block work.">incomplete</span> : null}
        </div></div><p className="pp-description">{issue.description}</p><div className="pp-issue-foot"><span>DISCOVERED <b>{shortDate(issue.discovered)}</b></span>
          {!issue.open ? <span>RESOLVED <b>{issue.resolvedAt ? <time dateTime={issue.resolvedAt} title={issue.resolvedAt}>{new Date(issue.resolvedAt).toLocaleString('en-GB')}</time> : 'Not recorded'}</b></span> : null}
          <span>LINKED <b>{activities.length} activities / {streams.join(', ') || 'none'}</b></span>{issue.jiraUrl ? <a href={issue.jiraUrl} target="_blank" rel="noopener noreferrer">Jira ↗</a> : null}
        </div></div>
      </article>
    })}
    {!visible.length ? <div className="pp-empty">No {historical ? 'closed' : 'active'} {blockersOnly ? 'blockers' : 'issues'}.</div> : null}
  </div></section>
}
