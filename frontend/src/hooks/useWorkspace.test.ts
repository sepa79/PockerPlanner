import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type PlannerApi } from '../api/plannerApi'
import type { Workspace } from '../api/types'
import { useWorkspace } from './useWorkspace'

class Source extends EventTarget {
  static instances: Source[] = []
  onerror: (() => void) | null = null
  closed = false
  constructor(readonly url: string) { super(); Source.instances.push(this) }
  close() { this.closed = true }
  revision(revision: number) { this.dispatchEvent(new MessageEvent('revision', { data: JSON.stringify({ revision }) })) }
}

const snapshot = (revision = 0): Workspace => ({ schemaVersion: 1, revision, plans: [] })
function fixture() {
  const api = { state: vi.fn().mockResolvedValue(snapshot()), info: vi.fn().mockResolvedValue({ version: '0.2.3-dev' }), saveState: vi.fn(), importWorkspace: vi.fn(), saveActivity: vi.fn() } as unknown as PlannerApi
  return { api, notify: vi.fn(), conflict: vi.fn() }
}
beforeEach(() => { Source.instances = []; vi.stubGlobal('EventSource', Source) })

describe('single workspace owner and live invalidation', () => {
  it('commits explicit imports through the same pending lock and canonical snapshot owner', async () => {
    const { api, notify, conflict } = fixture()
    let resolveImport: (value: Workspace) => void = () => {}
    vi.mocked(api.importWorkspace).mockImplementation(() => new Promise(resolve => { resolveImport = resolve }))
    const { result } = renderHook(() => useWorkspace(api, () => false, notify, conflict))
    await waitFor(() => expect(result.current.document?.revision).toBe(0))
    let pending: Promise<void>
    act(() => { pending = result.current.persist({ endpoint: 'import', document: snapshot() }) })
    expect(result.current.busy).toBe(true)
    await expect(result.current.persist({ endpoint: 'state', document: snapshot() })).rejects.toThrow('Wait for')
    await act(async () => { resolveImport(snapshot(1)); await pending! })
    expect(result.current.document?.revision).toBe(1)
    expect(result.current.busy).toBe(false)
    expect(api.importWorkspace).toHaveBeenCalledExactlyOnceWith(snapshot())
    expect(api.saveState).not.toHaveBeenCalled()
    expect(api.saveActivity).not.toHaveBeenCalled()
  })

  it('reloads a stale import conflict without retrying or silently replacing newer changes', async () => {
    const { api, notify, conflict } = fixture()
    const order: string[] = []
    const { result } = renderHook(() => useWorkspace(api, () => false, notify, conflict))
    await waitFor(() => expect(result.current.document?.revision).toBe(0))
    conflict.mockImplementation(() => order.push('discard'))
    vi.mocked(api.importWorkspace).mockRejectedValue(new ApiError('Conflict', 409))
    vi.mocked(api.state).mockImplementation(async () => { order.push('reload'); return snapshot(2) })
    await act(async () => { await expect(result.current.persist({ endpoint: 'import', document: snapshot() })).rejects.toThrow('Reopen details') })
    expect(order).toEqual(['discard', 'reload'])
    expect(result.current.document?.revision).toBe(2)
    expect(result.current.busy).toBe(false)
    expect(api.importWorkspace).toHaveBeenCalledTimes(1)
    expect(api.saveState).not.toHaveBeenCalled()
  })

  it('defers incoming revisions during editing and applies only the canonical snapshot after unlock', async () => {
    const { api, notify, conflict } = fixture()
    let locked = true
    const { result } = renderHook(() => useWorkspace(api, () => locked, notify, conflict))
    await waitFor(() => expect(result.current.document?.revision).toBe(0))
    vi.mocked(api.state).mockResolvedValue(snapshot(1))
    act(() => Source.instances[0].revision(1))
    expect(result.current.live).toBe('pending')
    expect(api.state).toHaveBeenCalledTimes(1)
    locked = false
    act(() => result.current.flush())
    await waitFor(() => expect(result.current.document?.revision).toBe(1))
    expect(notify).toHaveBeenCalledWith('Updated in another session')
    expect(result.current.live).toBe('live')
  })

  it('closes a conflicting editor before reloading without replaying its stale changes', async () => {
    const { api, notify, conflict } = fixture()
    const order: string[] = []
    conflict.mockImplementation(() => order.push('close'))
    const { result } = renderHook(() => useWorkspace(api, () => false, notify, conflict))
    await waitFor(() => expect(result.current.document?.revision).toBe(0))
    vi.mocked(api.saveState).mockRejectedValue(new ApiError('Conflict', 409))
    vi.mocked(api.state).mockImplementation(async () => { order.push('reload'); return snapshot(2) })
    await act(async () => { await expect(result.current.persist({ endpoint: 'state', document: snapshot() })).rejects.toThrow('Reopen details') })
    expect(order).toEqual(['close', 'reload'])
    expect(result.current.document?.revision).toBe(2)
    expect(api.saveState).toHaveBeenCalledTimes(1)
    expect(result.current.busy).toBe(false)
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Your edit was not saved'))
  })

  it('rejects double submission synchronously and releases the lock after a network failure', async () => {
    const { api, notify, conflict } = fixture()
    let reject: (reason: Error) => void = () => {}
    vi.mocked(api.saveState).mockImplementation(() => new Promise((_resolve, rejected) => { reject = rejected }))
    const { result } = renderHook(() => useWorkspace(api, () => false, notify, conflict))
    await waitFor(() => expect(result.current.document?.revision).toBe(0))
    let first: Promise<void>
    act(() => { first = result.current.persist({ endpoint: 'state', document: snapshot() }) })
    await expect(result.current.persist({ endpoint: 'state', document: snapshot() })).rejects.toThrow('Wait for')
    await act(async () => { reject(new Error('Disconnected')); await expect(first!).rejects.toThrow('Disconnected') })
    expect(result.current.busy).toBe(false)
    expect(result.current.document?.revision).toBe(0)
    expect(api.saveState).toHaveBeenCalledTimes(1)
  })

  it('never replaces a newer committed mutation with an older live response', async () => {
    const { api, notify, conflict } = fixture()
    let resolveLive: (value: Workspace) => void = () => {}
    const { result } = renderHook(() => useWorkspace(api, () => false, notify, conflict))
    await waitFor(() => expect(result.current.document?.revision).toBe(0))
    vi.mocked(api.state).mockImplementation(() => new Promise(resolve => { resolveLive = resolve }))
    act(() => Source.instances[0].revision(1))
    vi.mocked(api.saveState).mockResolvedValue(snapshot(2))
    await act(async () => { await result.current.persist({ endpoint: 'state', document: snapshot() }) })
    await act(async () => { resolveLive(snapshot(1)) })
    expect(result.current.document?.revision).toBe(2)
  })

  it('cleans up subscriptions and does not apply late reads after unmount', async () => {
    const { api, notify, conflict } = fixture()
    const { unmount } = renderHook(() => useWorkspace(api, () => false, notify, conflict))
    const source = Source.instances[0]
    unmount()
    expect(source.closed).toBe(true)
  })
})
