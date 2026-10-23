import type { Activity, ActivityActions } from '../api/types'

export type ExecutionOriginal = Pick<Activity, 'progress' | 'startedAt' | 'completedAt'>
export type ActualField = 'startedAt' | 'completedAt'
export interface ExecutionDate { value: string; offset: string; automatic: boolean }
export interface ExecutionDraft {
  started: boolean
  done: boolean
  progress: string
  sliderProgress: number
  startedAction: boolean | null
  doneAction: boolean | null
  startedAt: ExecutionDate
  completedAt: ExecutionDate
}
export type ExecutionChange = { kind: 'started' } | { kind: 'done' } | { kind: 'progress'; value: string }
  | { kind: 'date'; field: ActualField; value: string } | { kind: 'offset'; field: ActualField; value: string }
export type ExecutionErrors = Partial<Record<ActualField | 'progress', string>>

export function localDate(value: string | Date): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Choose a valid actual date and time.')
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function localTimes(value: string): Date[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return []
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return []
  const normalized = value.length === 16 ? `${value}:00` : value
  const offsets = new Set([-1, 0, 1].map(day => new Date(parsed.getTime() + day * 86400000).getTimezoneOffset()))
  return [...offsets].map(offset => new Date(parsed.getTime() + (offset - parsed.getTimezoneOffset()) * 60000))
    .filter(candidate => localDate(candidate) === normalized).sort((first, second) => first.getTime() - second.getTime())
}

export function offsetLabel(offset: number): string {
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0')
  return `UTC${offset <= 0 ? '+' : '-'}${hours}:${minutes}`
}

function recordedDate(value: string | null | undefined): ExecutionDate {
  return { value: value ? localDate(value) : '', offset: value ? String(new Date(value).getTimezoneOffset()) : '', automatic: false }
}

export function createExecutionDraft(item: ExecutionOriginal): ExecutionDraft {
  return {
    started: Boolean(item.startedAt), done: item.progress === 100, progress: String(item.progress), sliderProgress: item.progress,
    startedAction: null, doneAction: null, startedAt: recordedDate(item.startedAt), completedAt: recordedDate(item.completedAt),
  }
}

function stageDate(original: string | null | undefined, now: string): ExecutionDate {
  return original ? recordedDate(original) : { value: localDate(now), offset: '', automatic: true }
}

export function changeExecution(draft: ExecutionDraft, original: ExecutionOriginal, change: ExecutionChange, now: string): ExecutionDraft {
  if (change.kind === 'offset') return { ...draft, [change.field]: { ...draft[change.field], offset: change.value } }
  if (change.kind === 'date') {
    const previous = draft[change.field]
    const recorded = original[change.field]
    const candidates = localTimes(change.value)
    const sameDay = (value: string) => value.slice(0, 10) === change.value.slice(0, 10)
    const preferred = [sameDay(previous.value) ? previous.offset : '', recorded && sameDay(localDate(recorded)) ? String(new Date(recorded).getTimezoneOffset()) : '']
    const offset = preferred.find(value => candidates.some(candidate => String(candidate.getTimezoneOffset()) === value)) ?? ''
    return { ...draft, [change.field]: { value: change.value, offset, automatic: false } }
  }
  if (change.kind === 'started') {
    if (draft.started) return {
      ...draft, started: false, done: false, startedAction: false, doneAction: false, progress: '0', sliderProgress: 0,
      startedAt: recordedDate(null), completedAt: recordedDate(null),
    }
    return { ...draft, started: true, startedAction: true, startedAt: stageDate(original.startedAt, now) }
  }
  if (change.kind === 'done') return {
    ...draft, done: !draft.done, doneAction: !draft.done, progress: draft.done ? '' : '100',
    sliderProgress: draft.done ? draft.sliderProgress : 100,
    completedAt: draft.done ? recordedDate(null) : stageDate(original.completedAt, now),
  }
  const progress = Number(change.value)
  if (!change.value || !Number.isInteger(progress) || progress < 0 || progress > 100) return { ...draft, progress: change.value }
  const done = progress === 100
  return {
    ...draft, progress: change.value, sliderProgress: progress, done, doneAction: done,
    completedAt: done ? (draft.completedAt.value ? draft.completedAt : stageDate(original.completedAt, now)) : recordedDate(null),
  }
}

function resolveDate(draft: ExecutionDate, original: string | null | undefined, now: string): string | null {
  if (!draft.value) return null
  if (draft.automatic) return now
  const candidates = localTimes(draft.value)
  const selected = candidates.length === 1 ? candidates[0] : candidates.find(candidate => String(candidate.getTimezoneOffset()) === draft.offset)
  if (!selected) return null
  if (original && draft.value === localDate(original) && selected.getTimezoneOffset() === new Date(original).getTimezoneOffset()) return original
  return selected.toISOString()
}

export function resolveExecution(draft: ExecutionDraft, original: ExecutionOriginal, now: string) {
  const errors: ExecutionErrors = {}
  const actions: ActivityActions = {}
  const progress = Number(draft.progress)
  if (!draft.progress || !Number.isInteger(progress) || progress < 0 || progress > 100) errors.progress = 'Enter a whole progress percentage from 0 to 100.'
  else if (draft.startedAction === false && progress > 0) errors.progress = 'Select Started before changing progress after a reset.'
  else if (draft.doneAction === false && progress === 100) errors.progress = 'Enter progress below 100% to undo Done.'
  if (draft.startedAction !== null) actions.started = draft.startedAction
  if (draft.doneAction !== null) actions.done = draft.doneAction
  const dates: Partial<Record<ActualField, string>> = {}
  for (const field of ['startedAt', 'completedAt'] as const) {
    const active = field === 'startedAt' ? draft.started : draft.done
    if (!active) continue
    const value = draft[field]
    const required = Boolean(original[field] || (field === 'startedAt' ? draft.startedAction : draft.doneAction))
    const actual = resolveDate(value, original[field], now)
    if (!value.value) {
      if (required) errors[field] = 'Enter the actual date and time.'
    } else if (!localTimes(value.value).length) errors[field] = 'Choose a valid local date and time.'
    else if (!actual) errors[field] = 'This local time occurs twice. Choose its UTC offset.'
    else if (new Date(actual).getTime() > new Date(now).getTime()) errors[field] = 'Actual dates cannot be in the future.'
    if (actual) {
      dates[field] = actual
      if (!value.automatic && actual !== original[field]) actions[field] = actual
    }
  }
  if (dates.startedAt && dates.completedAt && new Date(dates.startedAt) > new Date(dates.completedAt)) errors.completedAt = 'Actual finish cannot precede the actual start.'
  return { errors, actions, dates, progress, valid: Object.keys(errors).length === 0 }
}

export function executionPreview(item: Activity, draft: ExecutionDraft, now: string): Activity {
  const result = resolveExecution(draft, item, now)
  if (!result.valid) throw new Error(Object.values(result.errors)[0])
  const preview = { ...item, progress: result.progress, ...result.dates }
  if (!draft.done) delete preview.completedAt
  if (draft.startedAction === false) {
    delete preview.startedAt
    delete preview.completedAt
    delete preview.blockerTrackingSince
    delete preview.blockerIntervals
  }
  return preview
}
