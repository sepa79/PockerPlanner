import type { EditorKind, Plan, Workspace } from '../api/types'

export function CollectionsView({ tab, workspace, plan, canEdit, busy, onEdit, onSelect }: {
  tab: 'streams' | 'types' | 'plans'; workspace: Workspace; plan: Plan | null; canEdit: boolean; busy: boolean
  onEdit: (kind: EditorKind, id?: string) => void; onSelect: (id: string) => void
}) {
  const kind = tab === 'streams' ? 'stream' : tab === 'types' ? 'type' : 'plan'
  const title = tab === 'types' ? 'Activity types' : tab === 'plans' ? 'Plans' : 'Streams'
  return <section className="pp-panel" aria-label={title}><div className="pp-panel-toolbar"><h2>{title}</h2>{canEdit ? <button className="pp-primary" disabled={busy} onClick={() => onEdit(kind)}>＋ {kind === 'type' ? 'Activity type' : kind.charAt(0).toUpperCase() + kind.slice(1)}</button> : null}</div>
    <div className="pp-panel-body">{tab === 'plans' ? workspace.plans.map(item => <article key={item.id} className={`pp-plan-card${item.id === plan?.id ? ' pp-selected' : ''}`}>
      <div className="pp-panel-toolbar"><button className="pp-text-button pp-plan-name" disabled={busy} onClick={() => onSelect(item.id)}>{item.name}</button><button disabled={busy} onClick={() => onEdit('plan', item.id)}>{canEdit ? 'Edit' : 'Details'}</button></div>
      <p className="pp-description">{item.description}</p><p className="pp-muted">{item.streams.length} streams · {item.activities.length} activities · Deadline {item.deadline || 'not set'}</p>
    </article>) : tab === 'streams' ? plan?.streams.map(stream => <button key={stream.id} className="pp-collection-row" disabled={busy} onClick={() => onEdit('stream', stream.id)}><strong>{stream.name}{stream.dependsOn ? ' ↳' : ''}</strong><span className="pp-description">{stream.description}</span><span>{plan.activities.filter(activity => activity.streamId === stream.id).length} activities</span></button>) : plan?.activityTypes.map(type => <button key={type.id} className="pp-collection-row pp-type-row" disabled={busy} onClick={() => onEdit('type', type.id)}><span className="pp-type-color" style={{ background: type.color }} /><strong>{type.name}</strong><span>{canEdit ? 'Edit' : 'Details'}</span></button>)}
      {tab === 'plans' && !workspace.plans.length || tab === 'streams' && !plan?.streams.length || tab === 'types' && !plan?.activityTypes.length ? <div className="pp-empty">No {title.toLowerCase()} yet.</div> : null}
    </div></section>
}
