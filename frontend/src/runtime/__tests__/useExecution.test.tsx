import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionSnapshot } from '../../api/types'
import { useExecution, type ExecutionOptions } from '../useExecution'
import { apiFixture, deferred, snapshotFixture } from './fixtures'

let hidden = false
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-19T12:00:00Z'))
  hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
})
afterEach(() => { vi.useRealTimers() })
const settle = async () => { await act(async () => undefined) }
const tick = async (milliseconds: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds) }) }
const visibility = (value: boolean) => { act(() => { hidden = value; document.dispatchEvent(new Event('visibilitychange')) }) }
function mount(options: Partial<ExecutionOptions> = {}) {
  const execution = vi.fn().mockResolvedValue(snapshotFixture())
  const { api, fetcher } = apiFixture({ execution })
  const props: ExecutionOptions = { api, planId: 'plan', identityKey: 'session-one', enabled: true, ...options }
  return { ...renderHook(useExecution, { initialProps: props }), execution, fetcher, props }
}

describe('execution polling', () => {
  it.each([{ enabled: false }, { identityKey: null }, { planId: null }])('makes no protected request without an enabled context: %j', async options => {
    const view = mount(options)
    await act(async () => { await view.result.current.refresh() })
    await tick(30000)
    expect(view.execution).not.toHaveBeenCalled()
    expect(view.fetcher).not.toHaveBeenCalled()
    expect(view.result.current.snapshot).toBeNull()
  })
  it('polls after five seconds only while visible and enabled, retaining data while hidden', async () => {
    const view = mount()
    await settle()
    expect(view.execution).toHaveBeenCalledTimes(1)
    await tick(4999)
    expect(view.execution).toHaveBeenCalledTimes(1)
    await tick(1)
    expect(view.execution).toHaveBeenCalledTimes(2)
    visibility(true)
    await tick(10000)
    expect(view.execution).toHaveBeenCalledTimes(2)
    expect(view.result.current.snapshot).not.toBeNull()
    visibility(false)
    await settle()
    expect(view.execution).toHaveBeenCalledTimes(3)
    view.rerender({ ...view.props, enabled: false })
    await tick(30000)
    expect(view.execution).toHaveBeenCalledTimes(3)
    expect(view.result.current.snapshot).not.toBeNull()
    expect(view.result.current.outdated).toBe(true)
  })
  it('invalidates at fifteen seconds independently of a hung refresh', async () => {
    const next = deferred<ExecutionSnapshot>()
    const view = mount()
    await settle()
    view.execution.mockReturnValue(next.promise)
    await tick(5000)
    expect(view.result.current.pending).toBe(true)
    await tick(9999)
    expect(view.result.current.outdated).toBe(false)
    await tick(1)
    expect(view.result.current.outdated).toBe(true)
    expect(view.result.current.snapshot).not.toBeNull()
    expect(view.execution).toHaveBeenCalledTimes(2)
  })
  it('retains the last observation on outage and clears the error after explicit recovery', async () => {
    const view = mount()
    await settle()
    const saved = view.result.current.snapshot
    view.execution.mockRejectedValueOnce(new Error('PH unavailable'))
    await act(async () => { await view.result.current.refresh() })
    expect(view.result.current).toMatchObject({ snapshot: saved, error: 'PH unavailable', outdated: true, pending: false })
    await act(async () => { await view.result.current.refresh() })
    expect(view.result.current).toMatchObject({ error: '', outdated: false, pending: false })
  })
  it('invalidates exactly fifteen seconds after receipt, not an interval tick or server timestamp', async () => {
    const pending = deferred<ExecutionSnapshot>()
    const execution = vi.fn().mockReturnValue(pending.promise)
    const view = mount({ api: apiFixture({ execution }).api })
    await tick(321)
    await act(async () => { pending.resolve(snapshotFixture()) })
    view.rerender({ ...view.props, enabled: false })
    await tick(14999)
    expect(view.result.current.outdated).toBe(false)
    await tick(1)
    expect(view.result.current.outdated).toBe(true)
  })
  it('coalesces overlapping refreshes and bounds even a non-cooperative request at twenty seconds', async () => {
    const pending = deferred<ExecutionSnapshot>()
    const execution = vi.fn().mockReturnValue(pending.promise)
    const view = mount({ api: apiFixture({ execution }).api })
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => { first = view.result.current.refresh(); second = view.result.current.refresh() })
    expect(first).toBe(second)
    await tick(20000)
    expect(execution.mock.calls[0][1].aborted).toBe(true)
    expect(view.result.current).toMatchObject({ pending: false, outdated: true, snapshot: null })
    expect(view.result.current.error).toMatch(/timed out/)
    await act(async () => { pending.resolve(snapshotFixture()); await first })
    expect(view.result.current.snapshot).toBeNull()
    expect(execution).toHaveBeenCalledTimes(1)
  })
  it('clears on plan or actual identity change and ignores late old-generation results', async () => {
    const view = mount()
    await settle()
    const old = deferred<ExecutionSnapshot>()
    const next = deferred<ExecutionSnapshot>()
    view.execution.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    act(() => { void view.result.current.refresh() })
    const oldSignal = view.execution.mock.calls.at(-1)![1]
    view.rerender({ ...view.props, identityKey: 'same-user-new-auth-session' })
    expect(oldSignal.aborted).toBe(true)
    expect(view.result.current.snapshot).toBeNull()
    await act(async () => { old.resolve(snapshotFixture()) })
    expect(view.result.current.snapshot).toBeNull()
    const current = { ...snapshotFixture(), revision: 2 }
    await act(async () => { next.resolve(current) })
    expect(view.result.current.snapshot).toEqual(current)
    view.execution.mockReturnValue(new Promise(() => undefined))
    view.rerender({ ...view.props, planId: 'other' })
    expect(view.result.current.snapshot).toBeNull()
    expect(view.result.current.error).toBe('')
  })
  it('aborts a hidden in-flight observation without erasing the previous snapshot', async () => {
    const view = mount()
    await settle()
    const old = deferred<ExecutionSnapshot>()
    view.execution.mockReturnValue(old.promise)
    act(() => { void view.result.current.refresh() })
    const signal = view.execution.mock.calls.at(-1)![1]
    visibility(true)
    expect(signal.aborted).toBe(true)
    expect(view.result.current.pending).toBe(false)
    await act(async () => { old.resolve({ ...snapshotFixture(), revision: 100 }) })
    expect(view.result.current.snapshot?.revision).toBe(1)
    expect(view.result.current.error).toBe('')
  })
  it('rejects an invalid observation without erasing cached data', async () => {
    const view = mount()
    await settle()
    view.execution.mockResolvedValue({ runs: [], fetchedAt: 'invalid' })
    await act(async () => { await view.result.current.refresh() })
    expect(view.result.current.error).toBe('Invalid PH execution response')
    expect(view.result.current.snapshot?.runs).toHaveLength(2)
  })
  it('cleans up requests and clocks on unmount, including StrictMode generations', async () => {
    const execution = vi.fn().mockReturnValue(new Promise(() => undefined))
    const { api } = apiFixture({ execution })
    const view = renderHook(() => useExecution({ api, planId: 'plan', identityKey: 'session', enabled: true }), { wrapper: StrictMode })
    expect(execution).toHaveBeenCalledTimes(2)
    expect(execution.mock.calls[0][1].aborted).toBe(true)
    view.unmount()
    expect(execution.mock.calls[1][1].aborted).toBe(true)
    await settle()
    expect(vi.getTimerCount()).toBe(0)
  })
})
