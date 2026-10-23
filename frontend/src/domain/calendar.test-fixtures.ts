import type { Activity, Issue, Plan, Stream } from '../api/types'

type ActivityFixture = Pick<Activity, 'id' | 'streamId' | 'start' | 'durationDays'> & Partial<Activity>
type IssueFixture = Pick<Issue, 'id'> & Partial<Issue>
type StreamFixture = Pick<Stream, 'id'> & Partial<Stream>

interface PlanFixture {
  streams: StreamFixture[]
  activities: ActivityFixture[]
  issues?: IssueFixture[]
}

export function makeIssues(issues: IssueFixture[]): Issue[] {
  return issues.map(issue => ({
    title: issue.id, description: '', scope: 'ALL', streamIds: [], activityIds: [],
    blocker: false, discovered: '2026-10-13', open: true, descriptionIncomplete: false, jiraUrl: '',
    ...issue,
  }))
}

export function makePlan(document: PlanFixture): Plan {
  return {
    id: 'synthetic-plan', name: 'Synthetic plan', description: '',
    activityTypes: [{ id: 'type', name: 'Synthetic type', color: '#123456' }],
    streams: document.streams.map(stream => ({ name: stream.id, description: '', ...stream })),
    activities: document.activities.map(item => ({
      name: item.id, typeId: 'type', progress: 0, status: '', issueIds: [], jiraUrl: '', ...item,
    })),
    issues: makeIssues(document.issues ?? []),
  }
}
