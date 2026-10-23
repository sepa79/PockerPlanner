import { useState } from 'react'
import type { ActivityType, Identified, Issue, Plan, Stream } from '../api/types'
import { dependencyOptions } from '../domain/issues'
import { timestampDay } from '../domain/schedule'
import type { EditorProps } from './Editor'
import { EditorArea, EditorInput, EditorSelect } from './EditorFields'
import { EditorForm } from './EditorForm'
import { jiraError, saveEditorState, type StateEditorItem } from './EditorState'
import { LinkedRunsDetails } from './LinkedRunsDetails'

function createItem(kind: EditorProps['selection']['kind']): StateEditorItem {
  const id = crypto.randomUUID()
  switch (kind) {
    case 'plan': return { id, name: '', description: '', deadline: null, streams: [], activityTypes: [], activities: [], issues: [] }
    case 'stream': return { id, name: '', description: '', dependsOn: null }
    case 'type': return { id, name: '', color: '#ffc107' }
    case 'issue': return { id, title: '', description: '', scope: 'ALL', streamIds: [], activityIds: [], blocker: false, discovered: timestampDay(new Date().toISOString()), open: true, descriptionIncomplete: false, jiraUrl: '' }
    default: throw new Error('Use the scoped editor for activities.')
  }
}

export function EditorDetails({ plan, original, ...props }: EditorProps & { plan: Plan | null; original: Identified | null }) {
  const { kind } = props.selection
  const [draft, setDraft] = useState<StateEditorItem>(() => original as StateEditorItem | null ?? createItem(kind))
  const issue = kind === 'issue' ? draft as Issue : null
  return <EditorForm {...props} lifecycleLabel={issue && props.selection.id !== null ? issue.open ? 'Close issue' : 'Reopen issue' : undefined}
    buildSave={intent => {
      if (kind === 'issue') {
        const value = draft as Issue
        const error = jiraError(value.jiraUrl)
        if (error) throw new Error(error)
        if (value.scope === 'STREAMS' && !value.streamIds.length) throw new Error('Select at least one affected stream.')
        return saveEditorState(props.selection, { ...value, title: value.title.trim(), description: value.description.trim(), jiraUrl: value.jiraUrl.trim(),
          open: intent === 'lifecycle' ? !value.open : value.open, streamIds: value.scope === 'STREAMS' ? value.streamIds : [], activityIds: value.scope === 'ACTIVITIES' ? value.activityIds ?? [] : [] })
      }
      if (kind === 'plan') {
        const value = draft as Plan
        return saveEditorState(props.selection, { ...value, name: value.name.trim(), description: value.description.trim(), deadline: value.deadline || null })
      }
      if (kind === 'stream') {
        const value = draft as Stream
        return saveEditorState(props.selection, { ...value, name: value.name.trim(), description: value.description.trim(), dependsOn: value.dependsOn || null })
      }
      const value = draft as ActivityType
      return saveEditorState(props.selection, { ...value, name: value.name.trim() })
    }} details={locked => {
      if (props.selection.id === null || !['plan', 'stream'].includes(kind)) return null
      return <LinkedRunsDetails api={props.api} planId={plan!.id} activityIds={kind === 'plan' ? null : plan!.activities.filter(activity => activity.streamId === draft.id).map(activity => activity.id)} busy={locked} />
    }}>
    {() => {
      if (kind === 'plan') {
        const value = draft as Plan
        return <>
          <EditorInput name="name" label="Plan name" value={value.name} required maxLength={160} onChange={event => setDraft({ ...value, name: event.target.value })} />
          <EditorInput name="deadline" label="Deadline · optional target date" type="date" value={value.deadline ?? ''} onChange={event => setDraft({ ...value, deadline: event.target.value || null })} />
          <p className="pp-form-hint">The deadline stays fixed when activities move. Plan finish is calculated separately.</p>
          <EditorArea name="description" label="Plan description / testing approach" value={value.description} rows={12} maxLength={12000} onChange={event => setDraft({ ...value, description: event.target.value })} />
        </>
      }
      if (kind === 'stream') {
        const value = draft as Stream
        const predecessors = dependencyOptions(plan!.streams, value.id).filter(stream => stream.id === value.dependsOn || plan!.activities.some(activity => activity.streamId === stream.id))
        return <>
          <EditorInput name="name" label="Stream name" value={value.name} required maxLength={100} onChange={event => setDraft({ ...value, name: event.target.value })} />
          <EditorSelect name="dependsOn" label="Depends on · stream" value={value.dependsOn ?? ''} options={[{ id: '', name: 'None · manual start' }, ...predecessors]} onChange={dependsOn => setDraft({ ...value, dependsOn: dependsOn || null })} />
          <p className="pp-form-hint">The stream starts after its predecessor finishes. Activity spacing is preserved; linked activities follow their own predecessors.</p>
          <EditorArea name="description" label="Purpose / context" value={value.description} maxLength={2000} onChange={event => setDraft({ ...value, description: event.target.value })} />
        </>
      }
      if (kind === 'type') {
        const value = draft as ActivityType
        return <>
          <EditorInput name="name" label="Type name" value={value.name} required maxLength={80} onChange={event => setDraft({ ...value, name: event.target.value })} />
          <EditorInput name="color" label="Timeline color" type="color" value={value.color} required onChange={event => setDraft({ ...value, color: event.target.value })} />
        </>
      }
      const value = draft as Issue
      const urlError = jiraError(value.jiraUrl)
      return <>
        <EditorInput name="title" label="Issue title" value={value.title} required maxLength={160} onChange={event => setDraft({ ...value, title: event.target.value })} />
        <div className="pp-field">
          <div className="pp-issue-description-heading"><label htmlFor="field-description">Description</label>
            <label className="pp-check-field"><input type="checkbox" name="descriptionIncomplete" checked={value.descriptionIncomplete} aria-describedby="incomplete-hint"
              onChange={event => setDraft({ ...value, descriptionIncomplete: event.target.checked })} />Incomplete</label>
          </div>
          <textarea id="field-description" name="description" maxLength={2000} value={value.description} onChange={event => setDraft({ ...value, description: event.target.value })} />
          <span className="pp-form-hint" id="incomplete-hint">Marks missing details only; does not affect blockers or dates.</span>
        </div>
        <label className="pp-check-field"><input type="checkbox" name="blocker" checked={value.blocker} onChange={event => setDraft({ ...value, blocker: event.target.checked })} />Blocker</label>
        <div className="pp-form-grid">
          <EditorSelect name="scope" label="Affects" value={value.scope} options={[{ id: 'ALL', name: 'ALL streams' }, { id: 'STREAMS', name: 'Selected streams' }, { id: 'ACTIVITIES', name: 'Selected activities' }]}
            onChange={scope => setDraft({ ...value, scope: scope as Issue['scope'] })} />
          <EditorInput name="discovered" label="Discovered" type="date" required value={value.discovered} onChange={event => setDraft({ ...value, discovered: event.target.value })} />
        </div>
        {value.scope === 'STREAMS' && <fieldset className="pp-check-list"><legend>Affected streams</legend>
          {plan!.streams.map(stream => <label className="pp-check-field" key={stream.id}><input type="checkbox" name="streamIds" value={stream.id} checked={value.streamIds.includes(stream.id)} onChange={event => setDraft({ ...value,
            streamIds: event.target.checked ? [...value.streamIds, stream.id] : value.streamIds.filter(id => id !== stream.id),
          })} />{stream.name}</label>)}
        </fieldset>}
        {value.scope === 'ACTIVITIES' && <fieldset className="pp-check-list"><legend>Affected activities</legend>
          {plan!.activities.length ? plan!.activities.map(activity => <label className="pp-check-field" key={activity.id}>
            <input type="checkbox" name="activityIds" value={activity.id} checked={(value.activityIds ?? []).includes(activity.id)} onChange={event => setDraft({ ...value,
              activityIds: event.target.checked ? [...value.activityIds ?? [], activity.id] : (value.activityIds ?? []).filter(id => id !== activity.id),
            })} />{plan!.streams.find(stream => stream.id === activity.streamId)!.name} / {activity.name}
          </label>) : <p className="pp-form-hint">No activities yet.</p>}
        </fieldset>}
        <p>Status <strong>{value.open ? 'Open' : 'Closed'}</strong></p>
        {!value.open && <p className="pp-form-hint">Resolved: {value.resolvedAt ? <time dateTime={value.resolvedAt}>{new Date(value.resolvedAt).toLocaleString()}</time> : 'Not recorded'}</p>}
        <EditorInput name="jiraUrl" label="Jira ticket link · optional HTTPS" type="url" placeholder="https://…" maxLength={2000} value={value.jiraUrl} error={urlError} onChange={event => setDraft({ ...value, jiraUrl: event.target.value })} />
      </>
    }}
  </EditorForm>
}
