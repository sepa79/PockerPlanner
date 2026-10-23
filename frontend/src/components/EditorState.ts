import type { ActivityType, EditorSelection, EditorSave, Identified, Issue, Plan, Stream, Workspace } from '../api/types'

export type StateEditorItem = Plan | Stream | ActivityType | Issue

export function editorPlan(selection: EditorSelection): Plan | null {
  if (selection.kind === 'plan' && selection.id === null) return null
  const planId = selection.kind === 'plan' ? selection.id : selection.planId
  const plan = selection.workspace.plans.find(candidate => candidate.id === planId)
  if (!plan) throw new Error('This plan is unavailable. Close details and reload the workspace.')
  return plan
}

export function editorCollection(plan: Plan, kind: Exclude<EditorSelection['kind'], 'plan'>): Identified[] {
  switch (kind) {
    case 'activity': return plan.activities
    case 'stream': return plan.streams
    case 'type': return plan.activityTypes
    case 'issue': return plan.issues
  }
}

export function editorItem(selection: EditorSelection): Identified | null {
  const plan = editorPlan(selection)
  if (selection.id === null) return null
  if (selection.kind === 'plan') return plan
  const item = editorCollection(plan!, selection.kind).find(candidate => candidate.id === selection.id)
  if (!item) throw new Error('This item is unavailable. Close details and reload the workspace.')
  return item
}

function replace(items: Identified[], selection: EditorSelection, item: Identified) {
  if (selection.id === null) {
    if (items.some(candidate => candidate.id === item.id)) throw new Error('The new item ID already exists.')
    items.push(structuredClone(item))
  } else {
    const index = items.findIndex(candidate => candidate.id === selection.id)
    if (index < 0 || item.id !== selection.id) throw new Error('The selected item cannot be replaced.')
    items[index] = structuredClone(item)
  }
}

export function saveEditorState(selection: EditorSelection, item: StateEditorItem): EditorSave {
  if (selection.kind === 'activity') throw new Error('Activities must use the scoped activity editor.')
  const document: Workspace = structuredClone(selection.workspace)
  if (selection.kind === 'plan') replace(document.plans, selection, item)
  else {
    const plan = editorPlan({ ...selection, workspace: document })!
    replace(editorCollection(plan, selection.kind), selection, item)
  }
  return { endpoint: 'state', document }
}

export function deleteEditorState(selection: EditorSelection): EditorSave {
  if (selection.id === null) throw new Error('An unsaved item cannot be deleted.')
  editorItem(selection)
  const document = structuredClone(selection.workspace)
  if (selection.kind === 'plan') document.plans = document.plans.filter(plan => plan.id !== selection.id)
  else {
    const plan = editorPlan({ ...selection, workspace: document })!
    const items = editorCollection(plan, selection.kind)
    items.splice(items.findIndex(item => item.id === selection.id), 1)
    if (selection.kind === 'activity') {
      for (const issue of plan.issues) {
        if (issue.scope === 'ACTIVITIES') issue.activityIds = (issue.activityIds ?? []).filter(id => id !== selection.id)
      }
    }
    if (selection.kind === 'issue') {
      for (const activity of plan.activities) activity.issueIds = activity.issueIds.filter(id => id !== selection.id)
    }
  }
  return { endpoint: 'state', document }
}

export function jiraError(value: string): string | undefined {
  if (!value.trim()) return undefined
  try {
    const url = new URL(value.trim())
    if (url.protocol === 'https:' && url.hostname && !url.username && !url.password && !/\s/.test(value.trim())) return undefined
  } catch {}
  return 'Use an HTTPS Jira link with a host and no embedded credentials.'
}
