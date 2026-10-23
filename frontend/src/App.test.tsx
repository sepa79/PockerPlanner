import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type PlannerApi } from './api/plannerApi'
import type { Workspace } from './api/types'
import { App } from './App'
import { apiFixture, mockDialogs, workspaceFixture } from './components/Editor.testSupport'

const fixture = vi.hoisted(() => ({
  api: null as PlannerApi | null,
  auth: {
    session: { user: { username: 'local-admin' }, canEdit: true, configured: true },
    fetchWithAuth: vi.fn(), loading: false, signingIn: false, confirmationUrl: null, error: null,
    signIn: vi.fn(), signOut: vi.fn(), cancelSignIn: vi.fn(), openConfirmation: vi.fn(),
  },
}))

vi.mock('@pockethive/browser-auth', () => ({ usePocketAuth: () => fixture.auth }))
vi.mock('./api/plannerApi', async importOriginal => ({
  ...await importOriginal<typeof import('./api/plannerApi')>(),
  createPlannerApi: () => fixture.api,
}))

beforeEach(() => {
  mockDialogs()
  vi.stubGlobal('EventSource', class extends EventTarget { close() {} })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  sessionStorage.clear()
  fixture.api = apiFixture()
  vi.mocked(fixture.api.state).mockResolvedValue(workspaceFixture())
  vi.mocked(fixture.api.info).mockResolvedValue({ name: 'PocketPlanner', version: '0.2.3-dev' })
  vi.mocked(fixture.api.saveState).mockImplementation(async document => ({ ...structuredClone(document), revision: document.revision + 1 }))
  vi.mocked(fixture.api.execution).mockResolvedValue({ revision: 7, runs: [], limitReached: false, fetchedAt: '2026-10-21T12:00:00Z' })
})
afterEach(() => vi.unstubAllGlobals())

async function mount() {
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={['/plan']}><App /></MemoryRouter>)
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Active plan' })).toHaveValue('p'))
  return { user, api: fixture.api! }
}

async function newPlan(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'Plans' }))
  await user.click(screen.getByRole('button', { name: '＋ Plan' }))
  await user.type(screen.getByRole('textbox', { name: 'Plan name' }), 'New synthetic plan')
}

describe('planning navigation parity', () => {
  it('offers the original calendar ranges and renders a 28-day calendar without saving', async () => {
    const { user, api } = await mount()
    const range = screen.getByRole('combobox', { name: 'Visible calendar days' })
    expect(within(range).getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual(['7', '14', '21', '28'])
    await user.selectOptions(range, '28')
    expect(range).toHaveValue('28')
    expect(document.querySelectorAll('.pp-calendar-day')).toHaveLength(28)
    expect(api.saveState).not.toHaveBeenCalled()
  })

  it('retains the history filter across tabs, view modes and plan selection', async () => {
    const { user, api } = await mount()
    await user.click(screen.getByRole('tab', { name: /^Issues/ }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Issue status filter' }), 'historical')
    expect(screen.getByRole('button', { name: 'Stale link' })).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Plan' }))
    await user.click(screen.getByRole('tab', { name: /^Issues/ }))
    expect(screen.getByRole('combobox', { name: 'Issue status filter' })).toHaveValue('historical')
    await user.click(screen.getByRole('button', { name: 'Execution' }))
    await user.click(screen.getByRole('tab', { name: /^Issues/ }))
    expect(screen.getByRole('combobox', { name: 'Issue status filter' })).toHaveValue('historical')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Active plan' }), 'unrelated')
    expect(screen.getByRole('combobox', { name: 'Issue status filter' })).toHaveValue('historical')
    expect(screen.getByRole('button', { name: 'Stale link' })).toBeVisible()
    expect(api.saveState).not.toHaveBeenCalled()
  })

  it('shows active blockers when the warning is opened from the historical filter', async () => {
    const document = workspaceFixture()
    document.plans[1].issues[0].blocker = true
    vi.mocked(fixture.api!.state).mockResolvedValue(document)
    const { user } = await mount()
    await user.click(screen.getByRole('tab', { name: /^Issues/ }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Issue status filter' }), 'historical')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Active plan' }), 'unrelated')
    await user.click(screen.getByRole('button', { name: 'Show me the blockers' }))
    expect(screen.getByRole('combobox', { name: 'Issue status filter' })).toHaveValue('active')
    expect(screen.getByRole('button', { name: 'Blockers only' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'All issue' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Stale link' })).not.toBeInTheDocument()
  })

  it('selects a newly created plan only after the save succeeds', async () => {
    const { user, api } = await mount()
    let resolveSave: (value: Workspace) => void = () => {}
    vi.mocked(api.saveState).mockImplementation(() => new Promise(resolve => { resolveSave = resolve }))
    await newPlan(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('combobox', { name: 'Active plan' })).toHaveValue('p')
    const submitted = vi.mocked(api.saveState).mock.calls[0][0]
    const created = submitted.plans.find(plan => plan.name === 'New synthetic plan')!
    expect(created).toBeDefined()
    await act(async () => resolveSave({ ...submitted, revision: submitted.revision + 1 }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Active plan' })).toHaveValue(created.id))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([400, 409])('does not select an unsaved plan when saving returns %i', async status => {
    const { user, api } = await mount()
    vi.mocked(api.saveState).mockRejectedValue(new ApiError('Synthetic save rejected', status))
    await newPlan(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    if (status === 409) await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    else await screen.findByText('Synthetic save rejected', { exact: true })
    expect(screen.getByRole('combobox', { name: 'Active plan' })).toHaveValue('p')
    expect(within(screen.getByRole('combobox', { name: 'Active plan' })).queryByRole('option', { name: 'New synthetic plan' })).not.toBeInTheDocument()
    expect(api.saveState).toHaveBeenCalledTimes(1)
  })

  it('keeps the existing plan selected when creation is cancelled', async () => {
    const { user, api } = await mount()
    await newPlan(user)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('combobox', { name: 'Active plan' })).toHaveValue('p')
    expect(api.saveState).not.toHaveBeenCalled()
  })

  it('does not change selection when editing another existing plan', async () => {
    const { user, api } = await mount()
    await user.click(screen.getByRole('tab', { name: 'Plans' }))
    const card = screen.getByRole('button', { name: 'Unrelated plan' }).closest('article')!
    await user.click(within(card).getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Plan name' }), ' updated')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: 'Active plan' })).toHaveValue('p')
    expect(vi.mocked(api.saveState).mock.calls[0][0].plans.find(plan => plan.id === 'unrelated')?.name).toBe('Unrelated plan updated')
  })
})
