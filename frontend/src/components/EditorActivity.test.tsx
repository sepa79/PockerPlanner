import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Issue, Plan } from '../api/types'
import { Editor } from './Editor'
import { apiFixture, mockDialogs, selectionFixture } from './Editor.testSupport'

beforeEach(() => {
  mockDialogs()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime('2026-10-19T12:00:00Z')
})
afterEach(() => vi.useRealTimers())

function mount(scope: Issue['scope'] = 'ALL', activityId: string | null = 'a', configure?: (plan: Plan) => void) {
  const selection = selectionFixture('activity', activityId)
  const issue = selection.workspace.plans[0].issues[0]
  Object.assign(issue, { blocker: true, scope, streamIds: scope === 'STREAMS' ? ['s'] : [], activityIds: scope === 'ACTIVITIES' ? ['a'] : [] })
  configure?.(selection.workspace.plans[0])
  const before = structuredClone(selection.workspace)
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  render(<Editor selection={selection} canEdit busy={false} api={apiFixture()} onSave={onSave} onClose={onClose} />)
  return { selection, before, onSave, onClose, user: userEvent.setup() }
}

const projected = () => screen.getByText(/^Projected/)
const delay = () => document.getElementById('activity-blocker-delay')!

describe('activity timing with pending issue links', () => {
  it.each(['ALL', 'STREAMS', 'ACTIVITIES'] as const)('previews unlink/relink immediately for %s without saving', async scope => {
    const { selection, before, onSave, onClose, user } = mount(scope)
    const checkbox = screen.getByRole('checkbox', { name: 'All issue' })
    expect(checkbox).toBeChecked()
    expect(projected()).toHaveTextContent('2026-10-21')
    expect(delay()).toHaveTextContent('+1 calendar day')
    await user.click(checkbox)
    expect(projected()).toHaveTextContent('2026-10-20')
    expect(delay()).toHaveTextContent('+0 calendar days')
    await user.click(checkbox)
    expect(projected()).toHaveTextContent('2026-10-21')
    expect(delay()).toHaveTextContent('+1 calendar day')
    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
    expect(selection.workspace).toEqual(before)
  })

  it('previews an added link that the persisted issue scope does not yet include', async () => {
    const { selection, before, onSave, user } = mount('ACTIVITIES', 'other')
    const checkbox = screen.getByRole('checkbox', { name: 'All issue' })
    expect(checkbox).not.toBeChecked()
    expect(projected()).toHaveTextContent('2026-10-20')
    await user.click(checkbox)
    expect(projected()).toHaveTextContent('2026-10-21')
    expect(delay()).toHaveTextContent('+1 calendar day')
    expect(onSave).not.toHaveBeenCalled()
    expect(selection.workspace).toEqual(before)
  })

  it('keeps the predecessor blocked when unlinking only its successor', async () => {
    const { selection, before, onSave, user } = mount('ALL', 'after')
    const finish = projected().textContent
    await user.click(screen.getByRole('checkbox', { name: 'All issue' }))
    expect(projected().textContent).toBe(finish)
    expect(delay()).toHaveTextContent('+1 calendar day')
    expect(onSave).not.toHaveBeenCalled()
    expect(selection.workspace).toEqual(before)
  })

  it('preserves other selected blockers until the last one is unlinked', async () => {
    const { onSave, user } = mount('ALL', 'a', plan => { plan.issues[1].blocker = true })
    await user.click(screen.getByRole('checkbox', { name: 'All issue' }))
    expect(projected()).toHaveTextContent('2026-10-21')
    expect(delay()).toHaveTextContent('+1 calendar day')
    await user.click(screen.getByRole('checkbox', { name: 'Stream issue' }))
    expect(projected()).toHaveTextContent('2026-10-20')
    expect(delay()).toHaveTextContent('+0 calendar days')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0][0]).toMatchObject({ endpoint: 'activity', document: { item: { issueIds: [] } } })
  })

  it.each([
    { history: 'closed', endedAt: '2026-10-13T10:00:00Z', finish: '2026-10-20', days: '1' },
    { history: 'ongoing', endedAt: null, finish: '2026-10-21', days: '7.08' },
  ])('does not erase $history recorded blocking when the current blocker is unlinked', async ({ endedAt, finish, days }) => {
    const { selection, before, onSave, user } = mount('ALL', 'a', plan => {
      Object.assign(plan.activities[0], {
        startedAt: '2026-10-12T10:00:00Z', blockerTrackingSince: '2026-10-12T10:00:00Z',
        blockerIntervals: [{ issueId: 'all', startedAt: '2026-10-12T10:00:00Z', endedAt }],
      })
    })
    const history = screen.getByText(/^Recorded blocking/).textContent
    await user.click(screen.getByRole('checkbox', { name: 'All issue' }))
    expect(projected()).toHaveTextContent(finish)
    expect(screen.getByText(/^Recorded blocking/).textContent).toBe(history)
    expect(history).toContain(`${days} calendar days`)
    expect(onSave).not.toHaveBeenCalled()
    expect(selection.workspace).toEqual(before)
  })
})
