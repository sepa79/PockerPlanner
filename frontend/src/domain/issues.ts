import type { Activity, Issue, Plan } from '../api/types'

export const issueAffects = (issue: Issue, activity: Activity) => issue.scope === 'ALL'
  || (issue.scope === 'STREAMS' ? issue.streamIds.includes(activity.streamId) : (issue.activityIds ?? []).includes(activity.id))
export const openBlockers = (plan: Plan, activity: Activity) => plan.issues.filter(issue => issue.open && issue.blocker && issueAffects(issue, activity))
export const streamBlockers = (plan: Plan, streamId: string) => plan.issues.filter(issue => issue.open && issue.blocker
  && plan.activities.some(activity => activity.streamId === streamId && activity.progress < 100 && issueAffects(issue, activity)))
export function dependencyOptions<T extends { id: string; name: string; dependsOn?: string | null }>(items: T[], currentId: string) {
  const indexed = new Map(items.map(item => [item.id, item]))
  return items.filter(candidate => {
    const seen = new Set<string>()
    let current: T | undefined = candidate
    while (current) {
      if (current.id === currentId || seen.has(current.id)) return false
      seen.add(current.id)
      current = current.dependsOn ? indexed.get(current.dependsOn) : undefined
    }
    return true
  })
}
