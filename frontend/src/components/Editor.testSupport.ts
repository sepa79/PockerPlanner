import { vi } from 'vitest'
import type { PlannerApi } from '../api/plannerApi'
import type { Activity, EditorKind, EditorSelection, Plan, Workspace } from '../api/types'

export function workspaceFixture(): Workspace {
  const first: Activity = { id: 'a', name: 'First activity', streamId: 's', typeId: 't', start: '2026-10-12', durationDays: 3, progress: 50, status: 'Manual progress', issueIds: ['stale'], jiraUrl: '' }
  const plan: Plan = {
    id: 'p', name: 'Synthetic plan', description: 'Testing approach', deadline: '2026-11-01',
    streams: [{ id: 's', name: 'First stream', description: 'Stream context' }, { id: 'second', name: 'Second stream', description: '' }, { id: 'empty', name: 'Empty stream', description: '' }],
    activityTypes: [{ id: 't', name: 'Test', color: '#ffc107' }, { id: 'unused', name: 'Unused', color: '#112233' }],
    activities: [first, { ...first, id: 'after', name: 'Successor', dependsOn: 'a', issueIds: [] }, { ...first, id: 'other', name: 'Other activity', streamId: 'second', issueIds: [] }],
    issues: [
      { id: 'all', title: 'All issue', description: 'Issue details', scope: 'ALL', streamIds: [], blocker: false, discovered: '2026-10-12', open: true, descriptionIncomplete: true, jiraUrl: '' },
      { id: 'stream', title: 'Stream issue', description: '', scope: 'STREAMS', streamIds: ['s'], blocker: false, discovered: '2026-10-12', open: true, descriptionIncomplete: false, jiraUrl: '' },
      { id: 'stale', title: 'Stale link', description: '', scope: 'ACTIVITIES', streamIds: [], activityIds: ['other'], blocker: false, discovered: '2026-10-12', open: false, descriptionIncomplete: false, jiraUrl: '', resolvedAt: '2026-10-13T12:00:00Z' },
    ],
  }
  return { schemaVersion: 1, revision: 7, plans: [plan, { ...structuredClone(plan), name: 'Unrelated plan', id: 'unrelated' }] }
}

export function selectionFixture(kind: EditorKind = 'activity', id: string | null = 'a', workspace = workspaceFixture()): EditorSelection {
  return { kind, id, planId: 'p', workspace }
}

export function apiFixture(): PlannerApi {
  return {
    state: vi.fn(), info: vi.fn(), saveState: vi.fn(), importWorkspace: vi.fn(), saveActivity: vi.fn(), linkedRuns: vi.fn().mockResolvedValue({ revision: 7, runs: [], limitReached: false }),
    execution: vi.fn(), control: vi.fn(), operation: vi.fn(),
  }
}

export function mockDialogs() {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false } })
}
