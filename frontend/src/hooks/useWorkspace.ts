import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, type PlannerApi } from '../api/plannerApi'
import type { EditorSave, Workspace } from '../api/types'

export type LiveStatus = 'connecting' | 'live' | 'pending' | 'unavailable'

export function checkedWorkspace(value: Workspace): Workspace {
  if (!value || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.plans)) {
    throw new Error('Invalid workspace response')
  }
  return value
}

export function useWorkspace(api: PlannerApi, locked: () => boolean, notify: (message: string) => void, conflict: () => void) {
  const [document, setDocument] = useState<Workspace | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<LiveStatus>('connecting')
  const [version, setVersion] = useState('Version unavailable')
  const current = useRef(document)
  const pending = useRef(false)
  const callbacks = useRef({ locked, notify, conflict })
  callbacks.current = { locked, notify, conflict }
  const flushRef = useRef<() => void>(() => {})
  const accept = useCallback((next: Workspace) => {
    checkedWorkspace(next)
    if (current.current && next.revision < current.current.revision) return
    current.current = next
    setDocument(next)
    setError('')
  }, [])
  const reload = useCallback(async () => { accept(await api.state()) }, [api, accept])

  useEffect(() => {
    let disposed = false
    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let wanted = -1
    let fetching = false
    let available = false
    async function flush() {
      if (disposed || fetching) return
      if (wanted <= (current.current?.revision ?? -1)) { setLive(available ? 'live' : 'unavailable'); return }
      if (pending.current || callbacks.current.locked()) { setLive(available ? 'pending' : 'unavailable'); return }
      fetching = true
      let success = false
      try {
        const next = checkedWorkspace(await api.state())
        if (disposed) return
        if (next.revision < wanted) throw new Error('Live snapshot has not caught up')
        if (pending.current || callbacks.current.locked()) { setLive(available ? 'pending' : 'unavailable'); return }
        const changed = current.current && next.revision > current.current.revision
        accept(next)
        if (changed) callbacks.current.notify('Updated in another session')
        setLive(available ? 'live' : 'unavailable')
        success = true
      } catch { if (!disposed) setLive('unavailable') }
      finally {
        fetching = false
        if (!disposed && wanted > (current.current?.revision ?? -1) && !pending.current && !callbacks.current.locked()) {
          clearTimeout(retry)
          retry = setTimeout(() => { void flush() }, success ? 0 : 1500)
        }
      }
    }
    function connect() {
      if (disposed) return
      source?.close()
      available = false
      setLive('connecting')
      source = new EventSource('/api/events')
      source.addEventListener('revision', event => {
        try {
          const revision: unknown = JSON.parse((event as MessageEvent<string>).data).revision
          if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid revision')
          wanted = Math.max(wanted, revision)
          available = true
          void flush()
        } catch { available = false; setLive('unavailable') }
      })
      source.addEventListener('unavailable', () => { available = false; setLive('unavailable') })
      source.onerror = () => { available = false; setLive('unavailable') }
    }
    const offline = () => { source?.close(); available = false; setLive('unavailable') }
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) connect() }
    const pagehide = () => { source?.close(); available = false }
    flushRef.current = () => { void flush() }
    void api.state().then(next => { if (!disposed) accept(next) }).catch(failure => { if (!disposed) setError(message(failure)) })
    void api.info().then(info => { if (!disposed) setVersion(`v${info.version}`) }).catch(() => {})
    connect()
    window.addEventListener('online', connect)
    window.addEventListener('offline', offline)
    window.addEventListener('pageshow', pageshow)
    window.addEventListener('pagehide', pagehide)
    return () => {
      disposed = true
      source?.close()
      clearTimeout(retry)
      window.removeEventListener('online', connect)
      window.removeEventListener('offline', offline)
      window.removeEventListener('pageshow', pageshow)
      window.removeEventListener('pagehide', pagehide)
      flushRef.current = () => {}
    }
  }, [api, accept])

  const persist = useCallback(async (payload: EditorSave) => {
    if (pending.current) throw new Error('Wait for the current update to finish.')
    pending.current = true
    setBusy(true)
    try {
      accept(await (payload.endpoint === 'activity' ? api.saveActivity(payload.document)
        : payload.endpoint === 'import' ? api.importWorkspace(payload.document) : api.saveState(payload.document)))
      callbacks.current.notify('Plan saved')
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) {
        callbacks.current.conflict()
        callbacks.current.notify('Plan changed elsewhere. Your edit was not saved. Reopen details to review the latest data.')
        await reload()
        throw new Error('Plan changed elsewhere. Your edit was not saved. Reopen details to review the latest data.')
      }
      throw failure
    } finally {
      pending.current = false
      setBusy(false)
      flushRef.current()
    }
  }, [api, accept, reload])
  return { document, error, busy, live, version, reload, persist, flush: useCallback(() => flushRef.current(), []) }
}

export function message(failure: unknown) { return failure instanceof Error ? failure.message : String(failure) }
