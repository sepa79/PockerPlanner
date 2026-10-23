import type { ExecutionRun, Plan } from '../api/types'
import { associationNames, describe, generatorTps } from './helpers'

export function RunBadge({ plan, run, outdated, onSelectRun }: {
  plan: Plan; run: ExecutionRun; outdated: boolean; onSelectRun: (run: ExecutionRun) => void
}) {
  const observation = describe(run, outdated)
  const tps = generatorTps(run, outdated)
  const associations = associationNames(plan, run)
  const linkedCount = new Set(run.activityIds).size
  return <button type="button" className={`pp-runtime-run ${observation.kind}`} onClick={() => onSelectRun(run)}
    aria-label={`${run.swarmId} · ${observation.label} · Open swarm panel`}
    title={`Run ${run.runId} · Linked: ${associations.join(', ') || 'unresolved'}`}>
    <span className="pp-runtime-dot" aria-hidden="true" />
    <span className="pp-runtime-name">{run.swarmId}</span>
    <span className="pp-runtime-state">{observation.label}</span>
    <span className="pp-runtime-tps" title={tps === null ? 'Generator TPS unavailable or stale' : 'Sum of fresh generator TPS only; downstream workers are not counted again'}>
      Generator TPS <b>{tps === null ? '—' : tps.toLocaleString('en-GB', { maximumFractionDigits: 1 })}</b>
    </span>
    {linkedCount > 1 && <span className="pp-runtime-shared">Shared · {linkedCount} Activities</span>}
    {run.unresolvedActivityTags.length > 0 && <span className="pp-runtime-warning">Unresolved links</span>}
  </button>
}
