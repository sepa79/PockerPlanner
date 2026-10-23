import { vi } from 'vitest'
import { createPlannerApi, type PlannerApi } from '../../api/plannerApi'
import type { Activity, ExecutionRun, ExecutionSnapshot, Plan, RunOperation } from '../../api/types'

const activity = (id: string, streamId: string, name: string, progress: number): Activity => ({
  id, streamId, name, progress, typeId: 'type', start: '2026-10-01', durationDays: 2, status: '', issueIds: [], jiraUrl: '',
})
export function planFixture(): Plan {
  return { id: 'plan', name: 'Synthetic runtime test', description: '', streams: [
    { id: 'one', name: 'One', description: '' }, { id: 'two', name: 'Two', description: '' },
  ], activities: [activity('minimal', 'one', 'Minimal', 25), activity('heavy', 'one', 'Heavy', 0), activity('background', 'two', 'Background', 100)],
  activityTypes: [{ id: 'type', name: 'Test', color: '#ffffff' }], issues: [{ id: 'blocker', title: 'Synthetic blocker', description: '', scope: 'ACTIVITIES',
    activityIds: ['heavy'], streamIds: [], blocker: true, discovered: '2026-10-01', open: true, descriptionIncomplete: false, jiraUrl: '' }] }
}

export function runFixture(): ExecutionRun {
  return { swarmId: 'shared', runId: 'run-1', scenarioId: 'Scenario', activityIds: ['minimal', 'heavy', 'background'], unresolvedActivityTags: [],
    journalUrl: 'https://ph.example/journal/swarms/shared?runId=run-1', canStart: true, canStop: true,
    runtime: { id: 'shared', runId: 'run-1', runtimeIntent: 'PRESENT', workloadState: 'STOPPED', workloadIntent: 'STOPPED', controllerState: 'READY',
      health: 'HEALTHY', runtimeResourceState: 'PRESENT', observedAt: '2026-10-19T12:00:00Z', observationStale: false, activeOperation: null,
      workers: ['generator', 'processor', 'postprocessor'].map(role => ({ instance: role, role, enabled: true, tps: 10, stale: false, lastSeenAt: '2026-10-19T12:00:00Z' })) } }
}

export function snapshotFixture(): ExecutionSnapshot {
  const run = runFixture()
  return { revision: 1, fetchedAt: '2026-10-19T12:00:00Z', limitReached: false,
    runs: [run, { ...run, runId: 'run-0', swarmId: 'old', activityIds: ['minimal'], runtime: null }] }
}

export const operationFixture = (state: string): RunOperation => ({ swarmId: 'shared', correlationId: 'operation', type: 'START', state, runtime: { runId: 'run-1' } })
export const accepted = { correlationId: 'operation', timeoutMs: 90000 }

export function apiFixture(overrides: Partial<PlannerApi> = {}) {
  const fetcher = vi.fn().mockRejectedValue(new Error('Unexpected API request in isolated runtime test'))
  return { api: { ...createPlannerApi(fetcher), ...overrides }, fetcher }
}

export function deferred<Result>() {
  let resolve!: (result: Result) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Result>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}
