import { useEffect, useRef, useState } from 'react'
import { ApiError, type PlannerApi } from '../api/plannerApi'
import type { RunCommand } from '../api/types'
import { failureMessage } from './helpers'
import { boundedRequest } from './request'

type Status = 'submitting' | 'pending' | 'uncertain' | 'success' | 'error'
export interface CommandState {
  request: RunCommand; status: Status; message: string; correlationId?: string; deadlineAt?: number
}
export const commandBusy = (command: CommandState | null): boolean => Boolean(command && ['submitting', 'pending', 'uncertain'].includes(command.status))
interface Controls { begin: (request: RunCommand) => void; retry: () => void; check: () => void }
const noControls: Controls = { begin: () => undefined, retry: () => undefined, check: () => undefined }

export function useRunCommand(api: PlannerApi, planId: string, onRefresh: () => unknown) {
  const [command, setCommand] = useState<CommandState | null>(null)
  const controls = useRef<Controls>(noControls)
  const refreshRef = useRef(onRefresh)
  refreshRef.current = onRefresh

  useEffect(() => {
    let alive = true
    let current: CommandState | null = null
    let controller: AbortController | null = null
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    setCommand(null)
    function publish(next: CommandState) {
      if (!alive) return
      current = next
      setCommand(next)
    }
    function expire() {
      if (!current || current.status !== 'pending') return
      publish({ ...current, status: 'uncertain', message: 'PH outcome has not been confirmed within the command timeout. Check outcome; do not submit a new command.' })
      clearTimeout(pollTimer)
      controller?.abort()
    }
    function terminal(request: CommandState, succeeded: boolean, state: string) {
      clearTimeout(deadlineTimer)
      publish({ ...request, status: succeeded ? 'success' : 'error', message: succeeded
        ? `${request.request.action === 'start' ? 'Start' : 'Stop'} succeeded · confirmed by PH.`
        : `PH operation ${state}. No change to Activity progress or dates.` })
      Promise.resolve().then(() => { if (alive) return refreshRef.current() }).catch(() => {
        if (alive && current?.request === request.request) publish({ ...current, message: `${current.message} Runtime refresh failed.` })
      })
    }
    async function poll() {
      const tracked = current
      if (!alive || !tracked || tracked.status !== 'pending' || !tracked.correlationId || controller) return
      if (Date.now() >= tracked.deadlineAt!) { expire(); return }
      if (document.hidden) return
      const requestController = new AbortController()
      controller = requestController
      try {
        const { request, correlationId } = tracked
        const result = await boundedRequest(signal => api.operation(planId, request.swarmId, request.runId, correlationId, signal),
          Math.min(10000, tracked.deadlineAt! - Date.now()), requestController.signal)
        if (!alive || current?.status !== 'pending' || current.request !== request) return
        if (Date.now() >= tracked.deadlineAt!) { expire(); return }
        if (result.swarmId !== request.swarmId || result.runtime?.runId !== request.runId
          || result.correlationId !== correlationId || result.type !== request.action.toUpperCase()) throw new Error('PH operation does not match the exact command')
        if (result.state === 'SUCCEEDED') terminal(tracked, true, result.state)
        else if (['REJECTED', 'FAILED', 'TIMED_OUT'].includes(result.state)) terminal(tracked, false, result.state)
        else if (!['ACCEPTED', 'DISPATCHED'].includes(result.state)) throw new Error('Invalid PH operation state')
      } catch (failure) {
        if (alive && current?.status === 'pending') publish({ ...current, message: `Operation observation unavailable: ${failureMessage(failure)}. Outcome not confirmed.` })
      } finally {
        if (controller === requestController) controller = null
        if (alive && current?.status === 'pending') {
          if (Date.now() >= current.deadlineAt!) expire()
          else if (!document.hidden) pollTimer = setTimeout(() => { void poll() }, 1500)
        }
      }
    }
    async function submit(tracked: CommandState) {
      if (!alive || controller) return
      publish({ ...tracked, status: 'submitting', message: `${tracked.request.action === 'start' ? 'Starting' : 'Stopping'} workload… Waiting for PH acceptance.` })
      const requestController = new AbortController()
      controller = requestController
      try {
        const result = await boundedRequest(signal => api.control(tracked.request, signal), 10000, requestController.signal)
        if (!alive) return
        if (!result || typeof result.correlationId !== 'string' || !result.correlationId
          || result.idempotencyKey !== tracked.request.idempotencyKey || !Number.isInteger(result.timeoutMs)
          || result.timeoutMs < 1 || result.timeoutMs > 180000) throw new Error('Invalid PH command acknowledgement; outcome unknown')
        publish({ ...tracked, status: 'pending', correlationId: result.correlationId, deadlineAt: Date.now() + result.timeoutMs,
          message: `Accepted by PH · ${result.correlationId}. Waiting for the authoritative outcome…` })
        deadlineTimer = setTimeout(expire, result.timeoutMs)
      } catch (failure) {
        if (!alive) return
        const definitive = failure instanceof ApiError && [400, 401, 403, 404, 409].includes(failure.status)
        publish({ ...tracked, status: definitive ? 'error' : 'uncertain', message: definitive ? failureMessage(failure)
          : `${failureMessage(failure)}. Outcome unknown. Retry uses the same request key, never a new command.` })
      } finally {
        if (controller === requestController) controller = null
        if (alive && current?.status === 'pending') void poll()
      }
    }
    controls.current = {
      begin(request) {
        if (request.planId !== planId || commandBusy(current)) return
        void submit({ request, status: 'submitting', message: '' })
      },
      retry() { if (current?.status === 'uncertain' && !current.correlationId) void submit(current) },
      check() {
        if (current?.status !== 'uncertain' || !current.correlationId || controller) return
        publish({ ...current, status: 'pending', deadlineAt: Date.now() + 10000, message: 'Checking the exact PH operation…' })
        deadlineTimer = setTimeout(expire, 10000)
        void poll()
      },
    }
    function visibilityChanged() {
      clearTimeout(pollTimer)
      if (!document.hidden) void poll()
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => {
      alive = false
      clearTimeout(pollTimer)
      clearTimeout(deadlineTimer)
      controller?.abort()
      controls.current = noControls
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [api, planId])

  return { command: command?.request.planId === planId ? command : null,
    begin: (request: RunCommand) => controls.current.begin(request), retry: () => controls.current.retry(), check: () => controls.current.check() }
}
