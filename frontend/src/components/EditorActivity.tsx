import { useState } from 'react'
import type { Activity, Plan } from '../api/types'
import { createExecutionDraft, executionPreview, resolveExecution } from '../domain/execution'
import { dependencyOptions, issueAffects } from '../domain/issues'
import { forecast, timestampDay, workingStart, type ActivitySchedule } from '../domain/schedule'
import { ActivityTiming } from './ActivityTiming'
import type { EditorProps } from './Editor'
import { EditorArea, EditorInput, EditorSelect } from './EditorFields'
import { EditorForm } from './EditorForm'
import { jiraError } from './EditorState'
import { ExecutionFields } from './ExecutionFields'
import { LinkedRunsDetails } from './LinkedRunsDetails'

function initialActivity(plan: Plan): Activity {
  return {
    id: crypto.randomUUID(), name: '', streamId: plan.streams[0].id, typeId: plan.activityTypes[0].id,
    start: workingStart(timestampDay(new Date().toISOString())), durationDays: 1, progress: 0, status: '', issueIds: [], jiraUrl: '',
  }
}

export function EditorActivity({ plan, original, ...props }: EditorProps & { plan: Plan; original: Activity | null }) {
  const [activity, setActivity] = useState(() => original ?? initialActivity(plan))
  const [duration, setDuration] = useState(() => String(activity.durationDays))
  const [execution, setExecution] = useState(() => createExecutionDraft(activity))
  const [issueIds, setIssueIds] = useState(() => plan.issues.filter(issue => issueAffects(issue, activity)).map(issue => issue.id))
  const now = new Date().toISOString()
  const executionResult = resolveExecution(execution, activity, now)
  const automatic = Boolean(activity.dependsOn || plan.streams.find(stream => stream.id === activity.streamId)?.dependsOn)
  const predecessors = dependencyOptions(plan.activities.filter(candidate => candidate.streamId === activity.streamId), activity.id)
  const urlError = jiraError(activity.jiraUrl)
  let preview: { item: Activity; schedule: ActivitySchedule; estimate: ActivitySchedule; blockerDelay: number } | undefined
  let previewError = ''
  try {
    if (!duration || !Number.isInteger(Number(duration)) || Number(duration) < 1 || Number(duration) > 365) throw new Error('Enter a whole full planned duration from 1 to 365 days.')
    const item = executionPreview({ ...activity, durationDays: Number(duration), issueIds }, execution, now)
    const draft: Plan = { ...plan, activities: props.selection.id === null ? [...plan.activities, item] : plan.activities.map(candidate => candidate.id === activity.id ? item : candidate) }
    const result = forecast(draft, timestampDay(now), (issue, candidate) => candidate.id === item.id
      ? issueIds.includes(issue.id)
      : issueAffects(issue, candidate))
    const schedule = result.projected.activities.get(activity.id)
    const estimate = result.baseline.activities.get(activity.id)
    const blockerDelay = result.blockerDelays.get(activity.id)
    if (!schedule || !estimate || blockerDelay === undefined) throw new Error('The activity schedule is unavailable.')
    preview = { item, schedule, estimate, blockerDelay }
  } catch (failure) { previewError = failure instanceof Error ? failure.message : 'The activity schedule could not be calculated.' }
  const update = (changes: Partial<Activity>) => setActivity(previous => ({ ...previous, ...changes }))
  const changeStream = (streamId: string) => {
    const next = { ...activity, streamId, dependsOn: null }
    setActivity(next)
    setIssueIds(plan.issues.filter(issue => issueAffects(issue, next)).map(issue => issue.id))
  }
  return <EditorForm {...props} buildSave={() => {
    const result = resolveExecution(execution, activity, new Date().toISOString())
    if (!result.valid) throw new Error(Object.values(result.errors)[0])
    if (previewError) throw new Error(previewError)
    if (urlError) throw new Error(urlError)
    return { endpoint: 'activity', document: {
      planId: plan.id, activityId: props.selection.id, expectedRevision: props.selection.workspace.revision,
      item: {
        id: activity.id, name: activity.name.trim(), streamId: activity.streamId, typeId: activity.typeId,
        start: activity.start, durationDays: Number(duration), includeWeekends: activity.includeWeekends === true,
        dependsOn: activity.dependsOn || null, progress: result.progress, status: activity.status.trim(), issueIds,
        jiraUrl: activity.jiraUrl.trim(), ...result.actions,
      },
    } }
  }} details={locked => <>
    {activity.jiraUrl.trim() && !urlError && <a className="pp-external-link" href={locked ? undefined : activity.jiraUrl.trim()} aria-disabled={locked} tabIndex={locked ? -1 : undefined} target="_blank" rel="noopener noreferrer">Open Jira ticket ↗</a>}
    {props.selection.id !== null && <LinkedRunsDetails api={props.api} planId={plan.id} activityIds={[activity.id]} busy={locked} />}
  </>}>
    {locked => <>
      <EditorInput name="name" label="Activity name" value={activity.name} required maxLength={160} onChange={event => update({ name: event.target.value })} />
      <div className="pp-form-grid">
        <EditorSelect name="streamId" label="Stream" value={activity.streamId} options={plan.streams} required onChange={changeStream} />
        <EditorSelect name="typeId" label="Activity type" value={activity.typeId} options={plan.activityTypes} required onChange={typeId => update({ typeId })} />
        <EditorInput name="start" label="Planned start date" type="date" required readOnly={automatic} value={automatic && preview ? preview.schedule.start : activity.start}
          onChange={event => { if (!automatic) update({ start: event.target.value }) }} />
        <div className="pp-field"><label htmlFor="field-durationDays">Full planned duration · {activity.includeWeekends ? 'calendar' : 'working'} days</label>
          <div className="pp-duration-stepper">
            <button id="duration-minus" type="button" className="pp-button" aria-label="Decrease planned duration by one day" disabled={locked} onClick={() => {
              const value = Number(duration)
              if (duration && Number.isInteger(value) && value >= 1 && value <= 365) setDuration(String(Math.max(1, value - 1)))
            }}>−</button>
            <input id="field-durationDays" name="durationDays" type="number" required min="1" max="365" step="1" value={duration} onChange={event => setDuration(event.target.value)} />
            <button id="duration-plus" type="button" className="pp-button" aria-label="Increase planned duration by one day" disabled={locked} onClick={() => {
              const value = Number(duration)
              if (duration && Number.isInteger(value) && value >= 1 && value <= 365) setDuration(String(Math.min(365, value + 1)))
            }}>+</button>
          </div>
        </div>
        <EditorSelect name="dependsOn" label="Depends on · activity" value={activity.dependsOn ?? ''} options={[{ id: '', name: 'None · manual start' }, ...predecessors]}
          onChange={dependsOn => update({ dependsOn: dependsOn || null })} />
      </div>
      <ExecutionFields value={execution} original={activity} disabled={locked} errors={executionResult.errors} onChange={setExecution} />
      <label className="pp-check-field"><input type="checkbox" name="includeWeekends" checked={activity.includeWeekends === true} aria-describedby="schedule-hint"
        onChange={event => update({ includeWeekends: event.target.checked })} />Include weekends</label>
      <p id="schedule-hint" className="pp-form-hint">Duration is the full planned time, never the time left.
        {preview && ` Scheduled ${preview.schedule.start} – ${preview.schedule.end}.`}
        {automatic && ` Start follows the predecessor; clear the dependency or move its predecessor to reschedule. Authored start retained: ${activity.start}.`}
        {activity.includeWeekends ? ' Weekends included.' : ' Weekends stay free; weekend starts begin on Monday.'}
      </p>
      {preview ? <ActivityTiming activity={preview.item} schedule={preview.schedule} estimate={preview.estimate} blockerDelay={preview.blockerDelay} now={now} />
        : <p className="pp-field-error" role="status">{previewError}</p>}
      <EditorArea name="status" label="Status / description" maxLength={1000} value={activity.status} onChange={event => update({ status: event.target.value })} />
      <fieldset className="pp-check-list"><legend>Linked issues</legend>
        {plan.issues.length ? plan.issues.map(issue => <label key={issue.id} className="pp-check-field">
          <input name="issueIds" type="checkbox" value={issue.id} checked={issueIds.includes(issue.id)} onChange={event => {
            setIssueIds(previous => event.target.checked ? [...previous, issue.id] : previous.filter(id => id !== issue.id))
          }} />{issue.title}
        </label>) : <p className="pp-form-hint">No issues yet. Add one from the main screen.</p>}
      </fieldset>
      <EditorInput name="jiraUrl" label="Jira ticket link · optional HTTPS" type="url" placeholder="https://…" maxLength={2000} value={activity.jiraUrl} error={urlError} onChange={event => update({ jiraUrl: event.target.value })} />
    </>}
  </EditorForm>
}
