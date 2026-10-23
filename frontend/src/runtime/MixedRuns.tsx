import type { ExecutionRun, Plan } from '../api/types'
import { activityRuns, isCurrent, key, streamRuns } from './helpers'
import { RunBadge } from './RunBadge'
import './runtime.css'

export interface MixedRunsProps {
  plan: Plan; runs: ExecutionRun[]; outdated: boolean; activityId?: string; streamId?: string
  onSelectRun: (run: ExecutionRun) => void
}

export function MixedRuns({ plan, runs, outdated, activityId, streamId, onSelectRun }: MixedRunsProps) {
  if ((activityId === undefined) === (streamId === undefined)) throw new Error('MixedRuns requires exactly one Activity or Stream ID')
  const linked = activityId !== undefined ? activityRuns(runs, activityId) : streamRuns(plan, runs, streamId!).filter(isCurrent)
  if (!linked.length) return null
  return <div className="pp-runtime-mixed" data-runtime-activity={activityId} data-runtime-stream={streamId}>
    <span className="pp-runtime-note">↳ Linked {activityId !== undefined ? 'runtime' : 'runtimes'} · associations, not active phases</span>
    <div className="pp-runtime-inline">{linked.map(run => <RunBadge key={key(run)} {...{ plan, run, outdated, onSelectRun }} />)}</div>
  </div>
}
