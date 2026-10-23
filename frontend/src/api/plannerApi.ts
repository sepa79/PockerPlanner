import type { ActivitySave, AuthFetch, CommandAck, ExecutionSnapshot, LinkedSnapshot, RunCommand, RunOperation, Workspace } from './types'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export function createPlannerApi(fetcher: AuthFetch) {
  async function request<Result>(path: string, init?: RequestInit): Promise<Result> {
    const response = await fetcher(path, { cache: 'no-store', ...init })
    const value = await response.json()
    if (!response.ok) throw new ApiError(typeof value?.error === 'string' ? value.error : 'Request failed', response.status)
    return value as Result
  }
  const json = (method: string, value: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
  return {
    state: () => request<Workspace>('/api/state'),
    info: () => request<{ name: string; version: string }>('/api/info'),
    saveState: (workspace: Workspace) => request<Workspace>('/api/state', json('PUT', workspace)),
    importWorkspace: (workspace: Workspace) => request<Workspace>('/api/state/import', json('PUT', workspace)),
    saveActivity: (value: ActivitySave) => request<Workspace>('/api/activities', json('PUT', value)),
    linkedRuns: (planId: string, signal?: AbortSignal) => request<LinkedSnapshot>(`/api/integration/runs?${new URLSearchParams({ planId })}`, { signal }),
    execution: (planId: string, signal?: AbortSignal) => request<ExecutionSnapshot>(`/api/integration/execution?${new URLSearchParams({ planId })}`, { signal }),
    control: (command: RunCommand, signal?: AbortSignal) => request<CommandAck>('/api/integration/control', { ...json('POST', command), signal }),
    operation: (planId: string, swarmId: string, runId: string, correlationId: string, signal?: AbortSignal) => request<RunOperation>(`/api/integration/operation?${new URLSearchParams({ planId, swarmId, runId, correlationId })}`, { signal }),
  }
}

export type PlannerApi = ReturnType<typeof createPlannerApi>
