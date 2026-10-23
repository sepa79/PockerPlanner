import type { Activity } from '../api/types'
import { timing, type ActivitySchedule } from '../domain/schedule'

interface ActivityTimingProps { activity: Activity; schedule: ActivitySchedule; estimate: ActivitySchedule; blockerDelay: number; now: string }

export function ActivityTiming({ activity, schedule, estimate, blockerDelay, now }: ActivityTimingProps) {
  const actual = timing(activity, now)
  const projection = timing({ ...activity, start: schedule.start }, now)
  const days = (value: number | null) => value === null ? 'Not recorded' : `${Number(value.toFixed(2))} calendar days`
  const timestamp = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : 'Not recorded'
  const unit = activity.includeWeekends ? 'calendar' : 'working'
  return <div id="activity-timing" className="pp-activity-timing" aria-live="polite">
    <p>Estimate <strong>{activity.durationDays} {unit} days</strong> · planned finish {estimate.end}</p>
    <p>Projected <strong>{projection.forecast ? schedule.end : timestamp(activity.completedAt)}</strong>{projection.forecast && ` · ≈ ${projection.remainingDays} ${unit} days left`}</p>
    <p id="activity-blocker-delay" title="Difference from the same forecast without blockers, including dependency effects; not recorded elapsed blocking time.">
      Blocker delay <strong>{projection.forecast ? `+${blockerDelay} calendar ${blockerDelay === 1 ? 'day' : 'days'}` : 'Not projected'}</strong> · {projection.forecast ? 'estimated finish delay' : 'no remaining-work forecast'}
    </p>
    <p>Actual <strong>{days(actual.elapsedDays)}</strong>{activity.progress < 100 && activity.startedAt && ' · so far'}</p>
    <p>Recorded blocking <strong>{days(actual.blockedDays)}</strong> · already included in actual time</p>
    <p className="pp-form-hint">Started: {timestamp(activity.startedAt)} · Done: {timestamp(activity.completedAt)}</p>
    <p className="pp-form-hint">≈ estimate × remaining %. Forecast includes issue delays; open blockers last through today.
      {activity.blockerTrackingSince ? ` Blocking tracked since ${timestamp(activity.blockerTrackingSince)}.` : ' Actual blocking time is tracked from Started.'}</p>
  </div>
}
