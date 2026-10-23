import { describe as suite, expect, it } from 'vitest'
import { activityRuns, canControl, describe, generatorTps, key, streamRuns } from '../helpers'
import { planFixture, runFixture, snapshotFixture } from './fixtures'

suite('pure runtime projections (ported Node assertions)', () => {
  it('uses exact run identities, without delimiter collisions', () => {
    expect(key({ swarmId: 'ab:c', runId: 'd' })).not.toBe(key({ swarmId: 'ab', runId: 'c:d' }))
    expect(key({ swarmId: 'swarm', runId: 'old' })).not.toBe(key({ swarmId: 'swarm', runId: 'new' }))
  })
  it('labels observations, never plan progress or actual phases', () => {
    const run = runFixture()
    run.runtime!.workloadState = 'RUNNING'
    expect(describe({ ...run, progress: 100 } as typeof run).label).toBe('Running')
    expect(describe({ ...run, progress: 0 } as typeof run).label).toBe('Running')
    run.runtime!.workloadState = 'STOPPED'
    expect(describe(run)).toEqual({ label: 'Stopped', kind: 'stopped' })
    run.runtime!.observationStale = true
    expect(describe(run).label).toBe('Observation stale')
    expect(describe(run, true).label).toBe('Status outdated')
    expect(describe({ ...run, runtime: null }).label).toBe('Not current')
    expect(describe({ ...run, runtime: { ...run.runtime!, runId: 'other-run' } }).label).toBe('Not current')
  })
  it('deduplicates shared associations once per Stream and remains immutable', () => {
    const plan = planFixture()
    const run = runFixture()
    const next = { ...run, runId: 'new', activityIds: ['heavy'] }
    const runs = [run, next, run]
    const before = JSON.stringify({ plan, runs })
    expect(streamRuns(plan, runs, 'one')).toEqual([run, next])
    expect(streamRuns(plan, runs, 'two')).toEqual([run])
    expect(streamRuns(plan, runs, 'unknown')).toEqual([])
    expect(JSON.stringify({ plan, runs })).toBe(before)
  })
  it('includes registered Stopped runs; history is opt-in with multiple exact runs per Activity', () => {
    const snapshot = snapshotFixture()
    snapshot.runs.push({ ...runFixture(), runId: 'run-2', runtime: { ...runFixture().runtime!, runId: 'run-2' }, activityIds: ['minimal'] })
    expect(activityRuns(snapshot.runs, 'minimal')).toHaveLength(2)
    expect(activityRuns(snapshot.runs, 'minimal', true)).toHaveLength(3)
    expect(activityRuns(snapshot.runs, 'heavy')).toHaveLength(1)
    expect(activityRuns(snapshot.runs, 'missing')).toHaveLength(0)
  })
  it('sums only fresh reported generator TPS, not pipeline throughput', () => {
    const run = runFixture()
    expect(generatorTps(run)).toBe(10)
    run.runtime!.workers.push({ instance: 'second', role: 'generator', enabled: true, tps: 5.5, stale: false, lastSeenAt: null })
    expect(generatorTps(run)).toBe(15.5)
    run.runtime!.workers[0].tps = 0
    expect(generatorTps(run)).toBe(5.5)
    expect(generatorTps(run, true)).toBeNull()
    run.runtime!.observationStale = true
    expect(generatorTps(run)).toBeNull()
  })
  it.each([{ tps: null, stale: false }, { tps: 5, stale: true }, { tps: 5, stale: null }, { tps: NaN, stale: false },
    { tps: Infinity, stale: false }, { tps: -1, stale: false }])('never fabricates zero or a partial total: %j', metrics => {
    const run = runFixture()
    run.runtime!.workers.push({ instance: 'unknown', role: 'generator', enabled: true, lastSeenAt: null, ...metrics })
    expect(generatorTps(run)).toBeNull()
  })
  it('missing, mismatched, non-generator and overflowing metrics are unknown', () => {
    const run = runFixture()
    expect(generatorTps({ ...run, runtime: null })).toBeNull()
    expect(generatorTps({ ...run, runtime: { ...run.runtime!, id: 'different-swarm' } })).toBeNull()
    run.runtime!.workers = run.runtime!.workers.filter(worker => worker.role !== 'generator')
    expect(generatorTps(run)).toBeNull()
    run.runtime!.workers = [0, 1].map(index => ({ instance: String(index), role: 'generator', enabled: true, lastSeenAt: null, stale: false, tps: Number.MAX_VALUE }))
    expect(generatorTps(run)).toBeNull()
  })
  it('never admits commands against stale, historical, denied or different runtime identities', () => {
    const run = runFixture()
    for (const action of ['start', 'stop'] as const) {
      expect(canControl(run, false, action)).toBe(true)
      expect(canControl(run, true, action)).toBe(false)
      expect(canControl({ ...run, runtime: null }, false, action)).toBe(false)
      expect(canControl({ ...run, runtime: { ...run.runtime!, observationStale: true } }, false, action)).toBe(false)
      expect(canControl({ ...run, runtime: { ...run.runtime!, runId: 'new-run' } }, false, action)).toBe(false)
      expect(canControl({ ...run, canStart: false, canStop: false }, false, action)).toBe(false)
      expect(canControl({ ...run, runtime: { ...run.runtime!, activeOperation: { type: 'STOP', correlationId: 'busy' } } }, false, action)).toBe(false)
    }
    run.runtime!.workloadState = 'RUNNING'
    expect(canControl(run, false, 'start')).toBe(false)
  })
})
