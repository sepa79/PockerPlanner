import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/plannerApi'
import type { LinkedRun, LinkedSnapshot } from '../api/types'
import { LinkedRunsDetails } from './LinkedRunsDetails'
import { apiFixture } from './Editor.testSupport'

const run: LinkedRun = { swarmId: 'swarm', runId: '12345678-actual-run', scenarioId: 'scenario', activityIds: ['a'], unresolvedActivityTags: [], journalUrl: 'https://ph.example.test/journal/run' }

describe('lazy protected linked run details', () => {
  it.each([['activity', ['a'], 1], ['stream', ['a', 'other'], 2], ['plan', null, 3]] as const)('filters exact associations for %s', async (_kind, activityIds, count) => {
    const api = apiFixture()
    vi.mocked(api.linkedRuns).mockResolvedValue({ revision: 7, runs: [run, { ...run, runId: 'other', activityIds: ['other'] }, { ...run, runId: 'untagged', activityIds: [] }], limitReached: true })
    const user = userEvent.setup()
    render(<LinkedRunsDetails api={api} planId="p" activityIds={activityIds === null ? null : [...activityIds]} />)
    expect(api.linkedRuns).not.toHaveBeenCalled()
    await user.click(screen.getByText('PocketHive runs'))
    expect(await screen.findAllByRole('link')).toHaveLength(count)
    expect(screen.getByText(/5,000-run limit/)).toBeVisible()
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('rel', 'noopener noreferrer')
    expect(api.linkedRuns).toHaveBeenCalledWith('p', expect.any(AbortSignal))
  })

  it('calls the authenticated API and surfaces 401 explicitly, never as an empty list', async () => {
    const api = apiFixture()
    vi.mocked(api.linkedRuns).mockRejectedValue(new ApiError('No session', 401))
    render(<LinkedRunsDetails api={api} planId="p" activityIds={null} />)
    await userEvent.setup().click(screen.getByText('PocketHive runs'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in with PocketHive')
    expect(screen.queryByText(/No linked runs/)).toBeNull()
  })

  it('aborts closed/unmounted reads and ignores stale completions', async () => {
    const api = apiFixture()
    let resolve!: (value: LinkedSnapshot) => void
    vi.mocked(api.linkedRuns).mockImplementation(() => new Promise(value => { resolve = value }))
    const { unmount } = render(<LinkedRunsDetails api={api} planId="p" activityIds={null} />)
    await userEvent.setup().click(screen.getByText('PocketHive runs'))
    const signal = vi.mocked(api.linkedRuns).mock.calls[0][1]!
    unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => resolve({ revision: 7, runs: [run], limitReached: false }))
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows safe text for errors and rejects executable journal URLs', async () => {
    const api = apiFixture()
    vi.mocked(api.linkedRuns).mockResolvedValue({ revision: 7, runs: [{ ...run, swarmId: '<img src=x>', journalUrl: 'javascript:alert(1)', unresolvedActivityTags: ['missing'] }], limitReached: false })
    render(<LinkedRunsDetails api={api} planId="p" activityIds={null} />)
    await userEvent.setup().click(screen.getByText('PocketHive runs'))
    expect(await screen.findByText(/Journal link unavailable/)).toHaveTextContent('<img src=x>')
    expect(screen.getByText(/unavailable Activities/)).toBeVisible()
    expect(screen.queryByRole('link')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
  })

  it('prevents disclosure and links from acting while a save is pending', async () => {
    const api = apiFixture()
    vi.mocked(api.linkedRuns).mockResolvedValue({ revision: 7, runs: [run], limitReached: false })
    const { rerender } = render(<LinkedRunsDetails api={api} planId="p" activityIds={null} busy />)
    fireEvent.click(screen.getByText('PocketHive runs'))
    expect(api.linkedRuns).not.toHaveBeenCalled()
    rerender(<LinkedRunsDetails api={api} planId="p" activityIds={null} />)
    await userEvent.setup().click(screen.getByText('PocketHive runs'))
    expect(await screen.findByRole('link')).toHaveAttribute('href')
    rerender(<LinkedRunsDetails api={api} planId="p" activityIds={null} busy />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/Open PH journal/)).not.toHaveAttribute('href')
  })
})
