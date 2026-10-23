import type { Activity } from '../api/types'

export function progress<Item extends Pick<Activity, 'progress'>>(activities: readonly Item[]): number | null {
  return activities.length
    ? Math.round(activities.reduce((total, activity) => total + activity.progress, 0) / activities.length)
    : null
}
