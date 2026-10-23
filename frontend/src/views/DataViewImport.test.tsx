import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { workspaceFixture } from '../components/Editor.testSupport'
import { DataView } from './DataView'

function fixture() {
  const workspace = workspaceFixture()
  const source = structuredClone(workspace)
  source.revision = 0
  Object.assign(source.plans[0].activities[0], {
    progress: 100, startedAt: '2026-10-12T09:00:00Z', completedAt: '2026-10-14T10:00:00Z',
    blockerTrackingSince: '2026-10-12T09:00:00Z', blockerIntervals: [],
  })
  const file = new File([JSON.stringify(source)], 'synthetic-historical-plan.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(source) })
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onBusyChange = vi.fn()
  render(<DataView workspace={workspace} selected={workspace.plans[0]} canEdit busy={false} onSave={onSave} onBusyChange={onBusyChange} />)
  return { workspace, source, file, onSave, onBusyChange, user: userEvent.setup() }
}

describe('confirmed historical workspace import', () => {
  it('preserves supplied facts, replaces only the file revision and submits explicit import intent', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    const { workspace, source, file, onSave, onBusyChange, user } = fixture()
    const before = structuredClone(workspace)
    await user.upload(screen.getByLabelText('Workspace file'), file)
    await user.click(screen.getByRole('button', { name: 'Import JSON' }))
    await screen.findByText('Workspace imported and saved.')
    expect(window.confirm).toHaveBeenCalledWith('Replace all current plans with this JSON file?')
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ endpoint: 'import', document: { ...source, revision: workspace.revision } })
    expect(onBusyChange.mock.calls.map(([busy]) => busy)).toEqual([true, false])
    expect(workspace).toEqual(before)
    expect(source.revision).toBe(0)
  })

  it('does not submit a cancelled replacement and unlocks the import controls', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    const { file, onSave, onBusyChange, user } = fixture()
    await user.upload(screen.getByLabelText('Workspace file'), file)
    await user.click(screen.getByRole('button', { name: 'Import JSON' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByText('Workspace imported and saved.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import JSON' })).toBeEnabled()
    expect(onBusyChange.mock.calls.map(([busy]) => busy)).toEqual([true, false])
  })

  it('reports a rejected import without claiming success or changing the canonical workspace', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    const { workspace, file, onSave, onBusyChange, user } = fixture()
    const before = structuredClone(workspace)
    onSave.mockRejectedValueOnce(new Error('Plan changed elsewhere. Your edit was not saved.'))
    await user.upload(screen.getByLabelText('Workspace file'), file)
    await user.click(screen.getByRole('button', { name: 'Import JSON' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Import failed: Plan changed elsewhere. Your edit was not saved.'))
    expect(screen.queryByText('Workspace imported and saved.')).not.toBeInTheDocument()
    expect(onSave).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Import JSON' })).toBeEnabled()
    expect(onBusyChange.mock.calls.map(([busy]) => busy)).toEqual([true, false])
    expect(workspace).toEqual(before)
  })
})
