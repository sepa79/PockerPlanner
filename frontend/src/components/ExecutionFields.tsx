import { useRef } from 'react'
import { changeExecution, localTimes, offsetLabel, type ActualField, type ExecutionDraft, type ExecutionErrors, type ExecutionOriginal } from '../domain/execution'

interface ExecutionFieldsProps {
  value: ExecutionDraft
  original: ExecutionOriginal
  disabled: boolean
  errors: ExecutionErrors
  onChange: (value: ExecutionDraft) => void
}

export function ExecutionFields({ value, original, disabled, errors, onChange }: ExecutionFieldsProps) {
  const progressRef = useRef<HTMLInputElement>(null)
  const change = (action: Parameters<typeof changeExecution>[2]) => {
    if (!disabled) onChange(changeExecution(value, original, action, new Date().toISOString()))
  }
  const dateField = (field: ActualField, label: string, active: boolean) => {
    if (!active) return null
    const candidates = localTimes(value[field].value)
    const repeated = candidates.length > 1 && !value[field].automatic
    return <div key={field} className="pp-field">
      <label htmlFor={`field-${field}`}>{label}</label>
      <input id={`field-${field}`} ref={input => { input?.setCustomValidity(errors[field] ?? '') }} name={field} type="datetime-local" step="1" value={value[field].value} disabled={disabled}
        required={Boolean(original[field] || (field === 'startedAt' ? value.startedAction : value.doneAction))}
        aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `${field}-error` : undefined}
        onChange={event => change({ kind: 'date', field, value: event.target.value })} />
      {repeated && <div className="pp-field">
        <label htmlFor={`field-${field}-offset`}>{label} · time occurrence</label>
        <select id={`field-${field}-offset`} value={value[field].offset} required disabled={disabled}
          onChange={event => change({ kind: 'offset', field, value: event.target.value })}>
          <option value="">Choose UTC offset</option>
          {candidates.map((candidate, index) => <option key={candidate.getTime()} value={String(candidate.getTimezoneOffset())}>
            {index === 0 ? 'Earlier' : 'Later'} · {offsetLabel(candidate.getTimezoneOffset())}
          </option>)}
        </select>
      </div>}
      {errors[field] && <span id={`${field}-error`} className="pp-field-error">{errors[field]}</span>}
    </div>
  }
  return <>
    <div className="pp-field">
      <label htmlFor="field-progress">Progress · %</label>
      <div className="pp-progress-controls">
        <button id="activity-started" type="button" className="pp-button" disabled={disabled} aria-pressed={value.started}
          title={value.started ? 'Undo Started and reset progress, actual dates and recorded blocking' : 'Set the actual start'}
          onClick={() => change({ kind: 'started' })}>Started</button>
        <input id="field-progress-slider" type="range" min="0" max="100" step="1" value={value.sliderProgress} aria-label="Progress slider"
          aria-valuetext={value.progress === '' ? 'Enter progress below 100% to undo Done' : `${value.progress}%`} disabled={disabled}
          onChange={event => change({ kind: 'progress', value: event.target.value })} />
        <input id="field-progress" ref={input => { progressRef.current = input; input?.setCustomValidity(errors.progress ?? '') }} name="progress" type="number" min="0" max="100" step="1" required value={value.progress} disabled={disabled}
          aria-invalid={Boolean(errors.progress)} aria-describedby={errors.progress ? 'progress-error' : undefined}
          onChange={event => change({ kind: 'progress', value: event.target.value })} />
        <button id="progress-done" type="button" className="pp-button" disabled={disabled} aria-pressed={value.done}
          title={value.done ? 'Undo Done and enter the correct progress' : 'Set 100% and the actual finish'}
          onClick={() => { change({ kind: 'done' }); if (value.done) progressRef.current?.focus() }}>Done</button>
      </div>
      {errors.progress && <span id="progress-error" className="pp-field-error">{errors.progress}</span>}
    </div>
    <div className="pp-form-grid pp-execution-dates">
      {dateField('startedAt', 'Actual start', value.started)}{dateField('completedAt', 'Actual finish', value.done)}
    </div>
    {value.doneAction === false && value.progress === '' && <p id="execution-hint" className="pp-form-hint">Enter progress below 100% to undo Done. The start date stays unchanged.</p>}
  </>
}
