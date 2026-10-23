export interface Identified { id: string; [field: string]: unknown }
export interface Stream extends Identified { name: string; description: string; dependsOn?: string | null }
export interface ActivityType extends Identified { name: string; color: string }
export interface BlockerInterval { issueId: string; startedAt: string; endedAt?: string | null }
export interface Activity extends Identified {
  name: string; streamId: string; typeId: string; start: string; durationDays: number; progress: number
  status: string; issueIds: string[]; jiraUrl: string; includeWeekends?: boolean; dependsOn?: string | null
  startedAt?: string | null; completedAt?: string | null; blockerTrackingSince?: string | null; blockerIntervals?: BlockerInterval[]
}
export interface Issue extends Identified {
  title: string; description: string; scope: 'ALL' | 'STREAMS' | 'ACTIVITIES'; streamIds: string[]; activityIds?: string[]
  blocker: boolean; discovered: string; open: boolean; descriptionIncomplete: boolean; jiraUrl: string; resolvedAt?: string | null
}
export interface Plan extends Identified {
  name: string; description: string; deadline?: string | null; streams: Stream[]; activityTypes: ActivityType[]; activities: Activity[]; issues: Issue[]
}
export interface Workspace { schemaVersion: 1; revision: number; plans: Plan[]; [field: string]: unknown }
export type EditorKind = 'activity' | 'stream' | 'type' | 'issue' | 'plan'
export interface EditorSelection { kind: EditorKind; id: string | null; planId: string | null; workspace: Workspace }
export interface ActivityActions { started?: boolean; done?: boolean; startedAt?: string; completedAt?: string }
export type ActivityInput = Activity & ActivityActions
export interface ActivitySave { planId: string; activityId: string | null; item: ActivityInput; expectedRevision: number }
export type EditorSave = { endpoint: 'state' | 'import'; document: Workspace } | { endpoint: 'activity'; document: ActivitySave }
export type ViewMode = 'plan' | 'execution' | 'mixed'
export type PlannerTab = 'plan' | 'issues' | 'streams' | 'types' | 'data' | 'plans'
export interface RuntimeWorker { instance: string; role: string; enabled: boolean | null; tps: number | null; stale: boolean | null; lastSeenAt: string | null }
export interface RuntimeState {
  id: string; runId: string; runtimeIntent: string; workloadIntent: string; controllerState: string
  workloadState: string; health: string; runtimeResourceState: string; observedAt: string | null; observationStale: boolean
  activeOperation: { type: string; correlationId: string } | null; workers: RuntimeWorker[]
}
export interface LinkedRun {
  swarmId: string; runId: string; scenarioId: string | null; activityIds: string[]; unresolvedActivityTags: string[]; journalUrl: string
}
export interface ExecutionRun extends LinkedRun { runtime: RuntimeState | null; canStart: boolean; canStop: boolean }
export interface LinkedSnapshot { revision: number; runs: LinkedRun[]; limitReached: boolean }
export interface ExecutionSnapshot { revision: number; runs: ExecutionRun[]; limitReached: boolean; fetchedAt: string }
export interface RunCommand { planId: string; swarmId: string; runId: string; action: 'start' | 'stop'; idempotencyKey: string }
export interface CommandAck { correlationId: string; idempotencyKey: string; timeoutMs: number }
export interface RunOperation { swarmId: string; correlationId: string; type: string; state: string; runtime: { runId: string }; [field: string]: unknown }
export type AuthFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
