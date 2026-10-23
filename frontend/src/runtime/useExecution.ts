import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlannerApi } from '../api/plannerApi'
import type { ExecutionSnapshot } from '../api/types'
import { failureMessage } from './helpers'
import { boundedRequest } from './request'

export interface ExecutionOptions { api: PlannerApi; planId: string | null; identityKey: string | null; enabled: boolean }
export interface ExecutionResult {
  snapshot: ExecutionSnapshot | null; outdated: boolean; pending: boolean; error: string; refresh: () => Promise<void>
}
interface Observation { context: string; snapshot: ExecutionSnapshot | null; receivedAt: number; pending: boolean; error: string }
const empty = (context: string): Observation => ({ context, snapshot: null, receivedAt: 0, pending: false, error: '' })

export function useExecution({ api, planId, identityKey, enabled }: ExecutionOptions): ExecutionResult {
  const context = JSON.stringify([planId, identityKey])
  const [observation, setObservation] = useState<Observation>(() => empty(context))
  const [, invalidateClock] = useState(0)
  const refreshRef = useRef<() => Promise<void>>(async () => undefined)
  const refresh = useCallback(() => refreshRef.current(), [])

  useEffect(() => {
    if (!observation.snapshot || observation.context !== context) return
    const timer = setTimeout(() => invalidateClock(previous => previous + 1), Math.max(0, observation.receivedAt + 15000 - Date.now()))
    return () => clearTimeout(timer)
  }, [context, observation.context, observation.snapshot, observation.receivedAt])

  useEffect(() => {
    let alive = true
    let generation = 0
    let controller: AbortController | null = null
    let inFlight: Promise<void> | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const needed = () => enabled && Boolean(planId && identityKey) && !document.hidden
    setObservation(previous => previous.context === context ? { ...previous, pending: false } : empty(context))

    function schedule() {
      clearTimeout(timer)
      if (alive && needed()) timer = setTimeout(() => { void load() }, 5000)
    }
    function load(): Promise<void> {
      if (!alive || !needed()) return Promise.resolve()
      if (inFlight) return inFlight
      clearTimeout(timer)
      const requestGeneration = ++generation
      const requestController = new AbortController()
      controller = requestController
      setObservation(previous => ({ ...(previous.context === context ? previous : empty(context)), pending: true }))
      const task = async () => {
        try {
          const snapshot = await boundedRequest(signal => api.execution(planId!, signal), 20000, requestController.signal)
          if (!snapshot || !Array.isArray(snapshot.runs) || !Number.isInteger(snapshot.revision)
            || typeof snapshot.limitReached !== 'boolean' || typeof snapshot.fetchedAt !== 'string'
            || !Number.isFinite(Date.parse(snapshot.fetchedAt))) throw new Error('Invalid PH execution response')
          if (alive && requestGeneration === generation) {
            const receivedAt = Date.now()
            setObservation({ context, snapshot, receivedAt, error: '', pending: false })
          }
        } catch (failure) {
          if (alive && requestGeneration === generation) setObservation(previous => ({ ...previous, error: failureMessage(failure), pending: false }))
        } finally {
          if (alive && requestGeneration === generation) {
            inFlight = null
            controller = null
            schedule()
          }
        }
      }
      inFlight = task()
      return inFlight
    }
    function visibilityChanged() {
      clearTimeout(timer)
      if (needed()) void load()
      else {
        generation++
        controller?.abort()
        controller = null
        inFlight = null
        setObservation(previous => ({ ...previous, pending: false }))
      }
    }
    refreshRef.current = load
    document.addEventListener('visibilitychange', visibilityChanged)
    void load()
    return () => {
      alive = false
      generation++
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [api, context, enabled, planId, identityKey])

  const current = observation.context === context ? observation : empty(context)
  return { snapshot: current.snapshot, error: current.error, pending: current.pending, refresh,
    outdated: Boolean(current.error || (current.snapshot && Date.now() - current.receivedAt >= 15000)) }
}
