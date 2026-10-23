import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/plannerApi'
import type { EditorSave } from '../api/types'
import { Editor, type EditorProps } from './Editor'
import { apiFixture, mockDialogs, selectionFixture, workspaceFixture } from './Editor.testSupport'

beforeEach(() => {
  mockDialogs()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime('2026-10-19T12:00:00Z')
})
afterEach(() => vi.useRealTimers())

function mount(selection = selectionFixture(), overrides: Partial<EditorProps> = {}) {
  const props: EditorProps = { selection, canEdit: true, busy: false, onClose: vi.fn(), onSave: vi.fn().mockResolvedValue(undefined), api: apiFixture(), ...overrides }
  return { ...render(<Editor {...props} />), props, user: userEvent.setup() }
}

async function saved(props: EditorProps): Promise<EditorSave> {
  await waitFor(() => expect(props.onSave).toHaveBeenCalledOnce())
  return vi.mocked(props.onSave).mock.calls[0][0]
}

describe('controlled activity editor', () => {
  it('shows actual issue-scope membership, not stale issueIds, and omits server-owned facts on save', async () => {
    const selection = selectionFixture()
    Object.assign(selection.workspace.plans[0].activities[0], { startedAt: '2026-10-12T10:00:00Z', blockerTrackingSince: '2026-10-12T10:00:00Z', blockerIntervals: [] })
    const before = structuredClone(selection.workspace)
    const { props, user } = mount(selection)
    expect(screen.getByRole('checkbox', { name: 'All issue' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Stream issue' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Stale link' })).not.toBeChecked()
    expect(document.getElementById('activity-timing')).toHaveTextContent('Estimate 3 working days')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const payload = await saved(props)
    expect(payload.endpoint).toBe('activity')
    if (payload.endpoint !== 'activity') throw new Error('Expected scoped save')
    expect(payload.document).toMatchObject({ planId: 'p', activityId: 'a', expectedRevision: 7, item: { id: 'a', issueIds: ['all', 'stream'], progress: 50, start: '2026-10-12' } })
    for (const field of ['startedAt', 'completedAt', 'blockerTrackingSince', 'blockerIntervals', 'started', 'done']) expect(payload.document.item).not.toHaveProperty(field)
    expect(selection.workspace).toEqual(before)
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('limits dependencies to in-stream non-cyclic candidates and retains the authored start during automatic scheduling', async () => {
    const { props, user } = mount(selectionFixture('activity', 'after'))
    const dependency = screen.getByRole('combobox', { name: 'Depends on · activity' })
    expect(within(dependency).getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual(['', 'a'])
    const start = screen.getByLabelText('Planned start date')
    expect(start).toHaveProperty('readOnly', true)
    expect(start).not.toHaveValue('2026-10-12')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const payload = await saved(props)
    expect(payload.endpoint === 'activity' && payload.document.item.start).toBe('2026-10-12')
    expect(payload.endpoint === 'activity' && payload.document.item.dependsOn).toBe('a')
  })

  it('recomputes scope membership and clears a cross-stream dependency when moving streams', async () => {
    const { props, user } = mount(selectionFixture('activity', 'after'))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Stream' }), 'second')
    expect(screen.getByRole('combobox', { name: 'Depends on · activity' })).toHaveValue('')
    expect(screen.getByLabelText('Planned start date')).toHaveProperty('readOnly', false)
    expect(screen.getByRole('checkbox', { name: 'All issue' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Stream issue' })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const payload = await saved(props)
    expect(payload.endpoint === 'activity' && payload.document.item).toMatchObject({ streamId: 'second', dependsOn: null, issueIds: ['all'] })
  })

  it('steps the full duration, preserves invalid drafts and updates weekend estimate units without saving', async () => {
    const { props, user } = mount()
    const duration = screen.getByRole('spinbutton', { name: 'Full planned duration · working days' })
    const plus = screen.getByRole('button', { name: 'Increase planned duration by one day' })
    const minus = screen.getByRole('button', { name: 'Decrease planned duration by one day' })
    await user.click(plus)
    expect(duration).toHaveValue(4)
    expect(document.getElementById('activity-timing')).toHaveTextContent('Estimate 4 working days')
    await user.click(minus)
    expect(duration).toHaveValue(3)
    for (const value of ['', '0', '366', '1.5']) {
      fireEvent.change(duration, { target: { value } })
      await user.click(plus)
      expect((duration as HTMLInputElement).value).toBe(value)
      expect(duration).toBeInvalid()
    }
    fireEvent.change(duration, { target: { value: '1' } })
    await user.click(minus)
    expect(duration).toHaveValue(1)
    fireEvent.change(duration, { target: { value: '365' } })
    await user.click(plus)
    expect(duration).toHaveValue(365)
    fireEvent.change(duration, { target: { value: '3' } })
    await user.click(screen.getByRole('checkbox', { name: 'Include weekends' }))
    expect(screen.getByRole('spinbutton', { name: 'Full planned duration · calendar days' })).toHaveValue(3)
    expect(document.getElementById('activity-timing')).toHaveTextContent('Estimate 3 calendar days')
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('undo Done asks for a blank manual percentage and sends no guessed date correction', async () => {
    const selection = selectionFixture()
    Object.assign(selection.workspace.plans[0].activities[0], { progress: 100, startedAt: '2026-10-12T10:00:00Z', completedAt: '2026-10-14T12:00:00Z' })
    const { props, user } = mount(selection)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    const progress = screen.getByRole('spinbutton', { name: 'Progress · %' })
    expect(progress).toHaveValue(null)
    expect(screen.getByText(/Enter progress below 100% to undo Done\. The start/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(props.onSave).not.toHaveBeenCalled()
    fireEvent.change(progress, { target: { value: '65' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const payload = await saved(props)
    expect(payload.endpoint === 'activity' && payload.document.item).toMatchObject({ progress: 65, done: false })
    if (payload.endpoint === 'activity') expect(payload.document.item).not.toHaveProperty('startedAt')
  })

  it('undo Started resets tracking through explicit server intents', async () => {
    const selection = selectionFixture()
    Object.assign(selection.workspace.plans[0].activities[0], { progress: 100, startedAt: '2026-10-12T10:00:00Z', completedAt: '2026-10-14T12:00:00Z', blockerTrackingSince: '2026-10-12T10:00:00Z', blockerIntervals: [] })
    const { props, user } = mount(selection)
    await user.click(screen.getByRole('button', { name: 'Started' }))
    expect(screen.getByRole('spinbutton', { name: 'Progress · %' })).toHaveValue(0)
    expect(screen.queryByLabelText('Actual start')).not.toBeInTheDocument()
    expect(document.getElementById('activity-timing')).toHaveTextContent('Recorded blocking Not recorded')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const payload = await saved(props)
    expect(payload.endpoint === 'activity' && payload.document.item).toMatchObject({ started: false, done: false, progress: 0, start: '2026-10-12', durationDays: 3 })
  })

  it('sets progress from the manual slider and stages Done only when it reaches 100', async () => {
    const { props, user } = mount()
    fireEvent.change(screen.getByRole('slider', { name: 'Progress slider' }), { target: { value: '100' } })
    expect(screen.getByRole('spinbutton', { name: 'Progress · %' })).toHaveValue(100)
    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const payload = await saved(props)
    expect(payload.endpoint === 'activity' && payload.document.item).toMatchObject({ progress: 100, done: true })
    if (payload.endpoint === 'activity') expect(payload.document.item).not.toHaveProperty('completedAt')
  })

  it('creates a stable new activity with a scoped null ID and inherited issue membership', async () => {
    const { props, user } = mount(selectionFixture('activity', null))
    await user.type(screen.getByRole('textbox', { name: 'Activity name' }), 'New activity')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const payload = await saved(props)
    expect(payload.endpoint === 'activity' && payload.document).toMatchObject({ activityId: null, expectedRevision: 7, item: { name: 'New activity', issueIds: ['all', 'stream'], progress: 0 } })
    if (payload.endpoint === 'activity') expect(payload.document.item.id).toMatch(/^[\da-f-]{36}$/)
    expect(props.selection.workspace.plans[0].activities).toHaveLength(3)
  })

  it('does not silently rebase the draft or scoped revision when newer props arrive', async () => {
    const selection = selectionFixture()
    const { props, user, rerender } = mount(selection)
    await user.clear(screen.getByRole('textbox', { name: 'Activity name' }))
    await user.type(screen.getByRole('textbox', { name: 'Activity name' }), 'Unsaved draft')
    const newer = structuredClone(selection)
    newer.workspace.revision = 99
    newer.workspace.plans[0].activities = []
    rerender(<Editor {...props} selection={newer} />)
    expect(screen.getByRole('textbox', { name: 'Activity name' })).toHaveValue('Unsaved draft')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const payload = await saved(props)
    expect(payload.endpoint === 'activity' && payload.document).toMatchObject({ expectedRevision: 7, activityId: 'a', item: { name: 'Unsaved draft' } })
  })

  it('reports rejected and malicious error strings as text and restores fields for retry', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('<img src=x onerror=alert(1)>')).mockResolvedValue(undefined)
    const { props, user } = mount(selectionFixture(), { onSave })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Activity name' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(props.onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it('locks every field and action, Escape and dismissal for the whole save promise', async () => {
    let rejectSave!: (failure: Error) => void
    const onSave = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectSave = reject }))
    const { props, user, container } = mount(selectionFixture(), { onSave })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    for (const control of container.querySelectorAll('input, select, textarea, button')) expect(control).toBeDisabled()
    const dialog = screen.getByRole('dialog')
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    fireEvent.submit(container.querySelector('form')!)
    expect(props.onClose).not.toHaveBeenCalled()
    expect(onSave).toHaveBeenCalledOnce()
    await act(async () => rejectSave(new Error('Offline')))
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Activity name' })).toBeEnabled()
  })

  it('validates optional HTTPS Jira links and never renders script links', async () => {
    const { props, user } = mount()
    fireEvent.change(screen.getByRole('textbox', { name: 'Jira ticket link · optional HTTPS' }), { target: { value: 'javascript:alert(1)' } })
    expect(screen.queryByRole('link', { name: /Open Jira/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(props.onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Jira ticket link · optional HTTPS' })).toBeInvalid()
    fireEvent.change(screen.getByRole('textbox', { name: 'Jira ticket link · optional HTTPS' }), { target: { value: 'https://jira.example.test/browse/PP-1' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const payload = await saved(props)
    expect(payload.endpoint === 'activity' && payload.document.item.jiraUrl).toBe('https://jira.example.test/browse/PP-1')
  })
})

describe('state editors', () => {
  it('edits plan description and deadline while preserving nested collections and unrelated plans', async () => {
    const selection = selectionFixture('plan', 'p')
    const before = structuredClone(selection.workspace)
    const { props, user } = mount(selection)
    fireEvent.change(screen.getByRole('textbox', { name: 'Plan description / testing approach' }), { target: { value: 'Updated approach' } })
    fireEvent.change(screen.getByLabelText('Deadline · optional target date'), { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const payload = await saved(props)
    if (payload.endpoint !== 'state') throw new Error('Expected state save')
    expect(payload.document.revision).toBe(7)
    expect(payload.document.plans[0]).toMatchObject({ description: 'Updated approach', deadline: null, activities: before.plans[0].activities, issues: before.plans[0].issues })
    expect(payload.document.plans[1]).toEqual(before.plans[1])
    expect(selection.workspace).toEqual(before)
  })

  it('filters stream dependencies to non-empty non-cyclic predecessors and saves context', async () => {
    const selection = selectionFixture('stream', 's')
    selection.workspace.plans[0].streams[1].dependsOn = 's'
    const { props, user } = mount(selection)
    const predecessor = screen.getByRole('combobox', { name: 'Depends on · stream' })
    expect(within(predecessor).getAllByRole('option')).toHaveLength(1)
    fireEvent.change(screen.getByRole('textbox', { name: 'Purpose / context' }), { target: { value: 'New stream context' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const payload = await saved(props)
    expect(payload.endpoint === 'state' && payload.document.plans[0].streams[0].description).toBe('New stream context')
  })

  it('edits activity type without changing activity references', async () => {
    const { props, user } = mount(selectionFixture('type', 't'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Type name' }), { target: { value: 'Load test' } })
    fireEvent.change(screen.getByLabelText('Timeline color'), { target: { value: '#123456' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const payload = await saved(props)
    expect(payload.endpoint === 'state' && payload.document.plans[0].activityTypes[0]).toMatchObject({ id: 't', name: 'Load test', color: '#123456' })
    expect(payload.endpoint === 'state' && payload.document.plans[0].activities).toEqual(props.selection.workspace.plans[0].activities)
  })

  it.each(['plan', 'stream', 'type', 'issue'] as const)('creates a new %s only in the selected workspace/plan', async kind => {
    const selection = selectionFixture(kind, null)
    const { props, user } = mount(selection)
    const name = { plan: 'Plan name', stream: 'Stream name', type: 'Type name', issue: 'Issue title' }[kind]
    await user.type(screen.getByRole('textbox', { name }), 'New item')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const payload = await saved(props)
    expect(payload.endpoint).toBe('state')
    if (payload.endpoint !== 'state') throw new Error('Expected state save')
    const items = kind === 'plan' ? payload.document.plans : kind === 'stream' ? payload.document.plans[0].streams : kind === 'type' ? payload.document.plans[0].activityTypes : payload.document.plans[0].issues
    expect(items.at(-1)?.id).toMatch(/^[\da-f-]{36}$/)
    expect(payload.document.plans[1]).toEqual(selection.workspace.plans[1])
  })
})

describe('issue lifecycle and explicit scope', () => {
  it('uses Save on Enter, then Close issue saves current fields without inventing a resolution time', async () => {
    const { props, user } = mount(selectionFixture('issue', 'all'))
    expect(screen.getByRole('checkbox', { name: 'Incomplete' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Incomplete' }).closest('.pp-issue-description-heading')).not.toBeNull()
    await user.type(screen.getByRole('textbox', { name: 'Issue title' }), '{Enter}')
    let payload = await saved(props)
    expect(payload.endpoint === 'state' && payload.document.plans[0].issues[0].open).toBe(true)
    vi.mocked(props.onSave).mockClear()
    await user.clear(screen.getByRole('textbox', { name: 'Issue title' }))
    await user.click(screen.getByRole('button', { name: 'Close issue' }))
    expect(props.onSave).not.toHaveBeenCalled()
    await user.type(screen.getByRole('textbox', { name: 'Issue title' }), 'New title')
    await user.click(screen.getByRole('checkbox', { name: 'Blocker' }))
    await user.click(screen.getByRole('button', { name: 'Close issue' }))
    payload = await saved(props)
    expect(payload.endpoint === 'state' && payload.document.plans[0].issues[0]).toMatchObject({ open: false, title: 'New title', blocker: true, descriptionIncomplete: true })
    if (payload.endpoint === 'state') expect(payload.document.plans[0].issues[0]).not.toHaveProperty('resolvedAt')
  })

  it('retains a recorded closed timestamp on edits and sends reopen intent without rewriting it locally', async () => {
    const { props, user } = mount(selectionFixture('issue', 'stale'))
    expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-10-13T12:00:00Z')
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Edited while closed' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    let payload = await saved(props)
    expect(payload.endpoint === 'state' && payload.document.plans[0].issues[2]).toMatchObject({ open: false, resolvedAt: '2026-10-13T12:00:00Z', description: 'Edited while closed' })
    vi.mocked(props.onSave).mockClear()
    await user.click(screen.getByRole('button', { name: 'Reopen issue' }))
    payload = await saved(props)
    expect(payload.endpoint === 'state' && payload.document.plans[0].issues[2].open).toBe(true)
  })

  it('supports ALL, STREAMS and empty explicit ACTIVITIES without retaining stale targets', async () => {
    const { props, user } = mount(selectionFixture('issue', 'all'))
    const scope = screen.getByRole('combobox', { name: 'Affects' })
    await user.selectOptions(scope, 'STREAMS')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(props.onSave).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Select at least one affected stream')
    await user.click(screen.getByRole('checkbox', { name: 'First stream' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    let payload = await saved(props)
    expect(payload.endpoint === 'state' && payload.document.plans[0].issues[0]).toMatchObject({ scope: 'STREAMS', streamIds: ['s'], activityIds: [] })
    vi.mocked(props.onSave).mockClear()
    await user.selectOptions(scope, 'ACTIVITIES')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    payload = await saved(props)
    expect(payload.endpoint === 'state' && payload.document.plans[0].issues[0]).toMatchObject({ scope: 'ACTIVITIES', streamIds: [], activityIds: [] })
    vi.mocked(props.onSave).mockClear()
    await user.click(screen.getByRole('checkbox', { name: 'First stream / First activity' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    payload = await saved(props)
    expect(payload.endpoint === 'state' && payload.document.plans[0].issues[0]).toMatchObject({ scope: 'ACTIVITIES', streamIds: [], activityIds: ['a'] })
    vi.mocked(props.onSave).mockClear()
    await user.selectOptions(scope, 'ALL')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    payload = await saved(props)
    expect(payload.endpoint === 'state' && payload.document.plans[0].issues[0]).toMatchObject({ scope: 'ALL', streamIds: [], activityIds: [] })
  })
})

describe('read-only, errors and destructive actions', () => {
  it.each([['activity', 'a'], ['stream', 's'], ['type', 't'], ['issue', 'all'], ['plan', 'p']] as const)('read-only %s exposes disabled details and Cancel only', async (kind, id) => {
    const { props, user, container } = mount(selectionFixture(kind, id), { canEdit: false })
    for (const control of container.querySelectorAll('input, select, textarea')) expect(control).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Close issue|Reopen issue/ })).not.toBeInTheDocument()
    fireEvent.submit(container.querySelector('form')!)
    expect(props.onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onClose).toHaveBeenCalledOnce()
    fireEvent.submit(container.querySelector('form')!)
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('read-only details can lazily request protected linked runs and show an explicit 401', async () => {
    const api = apiFixture()
    vi.mocked(api.linkedRuns).mockRejectedValue(new ApiError('Unauthorized', 401))
    const { user } = mount(selectionFixture(), { canEdit: false, api })
    expect(api.linkedRuns).not.toHaveBeenCalled()
    await user.click(screen.getByText('PocketHive runs'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in with PocketHive to see linked runs.')
    expect(api.linkedRuns).toHaveBeenCalledWith('p', expect.any(AbortSignal))
  })

  it('rejects a missing selection explicitly rather than creating an implicit replacement', () => {
    const { props } = mount(selectionFixture('activity', 'removed'))
    expect(screen.getByRole('alert')).toHaveTextContent('This item is unavailable')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('sends predecessor deletion to the core without removing dependent references', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const selection = selectionFixture()
    const onSave = vi.fn().mockRejectedValue(new ApiError('Activity depends on a missing predecessor', 400))
    const { props, user } = mount(selection, { onSave })
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const payload = await saved(props)
    expect(payload.endpoint === 'state' && payload.document.plans[0].activities.find(activity => activity.id === 'after')?.dependsOn).toBe('a')
    expect(await screen.findByRole('alert')).toHaveTextContent('missing predecessor')
    expect(selection.workspace.plans[0].activities.some(activity => activity.id === 'a')).toBe(true)
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('cleans only explicit activity issue targets on deletion and retains unrelated state/revision', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const selection = selectionFixture()
    selection.workspace.plans[0].issues[2].activityIds = ['a', 'other']
    const before = structuredClone(selection.workspace)
    const { props, user } = mount(selection)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const payload = await saved(props)
    if (payload.endpoint !== 'state') throw new Error('Expected state deletion')
    expect(payload.document.revision).toBe(7)
    expect(payload.document.plans[0].issues[2].activityIds).toEqual(['other'])
    expect(payload.document.plans[0].issues.slice(0, 2)).toEqual(before.plans[0].issues.slice(0, 2))
    expect(payload.document.plans[1]).toEqual(before.plans[1])
    expect(selection.workspace).toEqual(before)
  })

  it('preserves other issue links when an issue is deleted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { props, user } = mount(selectionFixture('issue', 'stale'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const payload = await saved(props)
    expect(payload.endpoint === 'state' && payload.document.plans[0].activities[0].issueIds).toEqual([])
    expect(payload.endpoint === 'state' && payload.document.plans[0].issues.map(issue => issue.id)).toEqual(['all', 'stream'])
  })

  it('respects a declined delete confirmation and Cancel discards all draft edits', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { props, user } = mount(selectionFixture('plan', 'p'))
    const original = structuredClone(props.selection.workspace)
    await user.type(screen.getByRole('textbox', { name: 'Plan name' }), ' unsaved')
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onSave).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(props.selection.workspace).toEqual(original)
  })

  it('renders untrusted names and descriptions as text', () => {
    const workspace = workspaceFixture()
    workspace.plans[0].issues[0].title = '<img src=x onerror=alert(1)>'
    workspace.plans[0].activities[0].status = '<script>alert(1)</script>'
    mount(selectionFixture('activity', 'a', workspace))
    expect(screen.getByRole('checkbox', { name: '<img src=x onerror=alert(1)>' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Status / description' })).toHaveValue('<script>alert(1)</script>')
    expect(document.querySelector('script, img')).toBeNull()
  })
})
