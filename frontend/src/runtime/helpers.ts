import type { ExecutionRun, LinkedRun, Plan } from '../api/types'

export const key = (run: Pick<LinkedRun, 'swarmId' | 'runId'>): string => JSON.stringify([run.swarmId, run.runId])

export const isCurrent = (run: ExecutionRun): boolean => Boolean(run.runtime
  && run.runtime.id === run.swarmId && run.runtime.runId === run.runId)

export function describe(run: ExecutionRun, outdated = false): { label: string; kind: 'running' | 'stopped' | 'unknown' } {
  if (outdated) return { label: 'Status outdated', kind: 'unknown' }
  if (!isCurrent(run)) return { label: 'Not current', kind: 'unknown' }
  if (run.runtime!.observationStale) return { label: 'Observation stale', kind: 'unknown' }
  const state = run.runtime!.workloadState
  return { label: state.charAt(0) + state.slice(1).toLowerCase(), kind: state === 'RUNNING' ? 'running' : state === 'STOPPED' ? 'stopped' : 'unknown' }
}

export function generatorTps(run: ExecutionRun, outdated = false): number | null {
  if (outdated || !isCurrent(run) || run.runtime!.observationStale) return null
  const generators = run.runtime!.workers.filter(worker => worker.role === 'generator')
  if (!generators.length || generators.some(worker => worker.stale !== false || typeof worker.tps !== 'number'
    || !Number.isFinite(worker.tps) || worker.tps < 0)) return null
  const total = generators.reduce((sum, worker) => sum + worker.tps!, 0)
  return Number.isFinite(total) ? total : null
}

function uniqueRuns(runs: readonly ExecutionRun[]): ExecutionRun[] {
  const seen = new Set<string>()
  return runs.filter(run => {
    const identity = key(run)
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

export function streamRuns(plan: Plan, runs: readonly ExecutionRun[], streamId: string): ExecutionRun[] {
  const activities = new Set(plan.activities.filter(activity => activity.streamId === streamId).map(activity => activity.id))
  return uniqueRuns(runs.filter(run => run.activityIds.some(activityId => activities.has(activityId))))
}

export function activityRuns(runs: readonly ExecutionRun[], activityId: string, history = false): ExecutionRun[] {
  return uniqueRuns(runs.filter(run => run.activityIds.includes(activityId) && (history || isCurrent(run))))
}

export function associationNames(plan: Plan, run: ExecutionRun): string[] {
  return plan.activities.filter(activity => run.activityIds.includes(activity.id)).map(activity => {
    const stream = plan.streams.find(item => item.id === activity.streamId)
    if (!stream) throw new Error(`Activity ${activity.id} references an unavailable Stream`)
    return `${stream.name} / ${activity.name}`
  })
}

export const canControl = (run: ExecutionRun | null, outdated: boolean, action: 'start' | 'stop'): boolean => Boolean(run
  && !outdated && isCurrent(run) && !run.runtime!.observationStale && !run.runtime!.activeOperation
  && (action === 'start' ? run.canStart && run.runtime!.workloadState !== 'RUNNING' : run.canStop))

export const failureMessage = (failure: unknown): string => failure instanceof Error ? failure.message : 'PocketHive request failed'
