import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { EditorSelection, EditorSave } from '../api/types'
import { deleteEditorState } from './EditorState'
import { Dialog } from './Dialog'

export interface EditorFormProps {
  selection: EditorSelection
  canEdit: boolean
  busy: boolean
  onClose: () => void
  onSave: (payload: EditorSave) => Promise<void>
  buildSave: (intent: 'save' | 'lifecycle') => EditorSave
  children: (locked: boolean) => ReactNode
  details?: (locked: boolean) => ReactNode
  lifecycleLabel?: string
}

export function EditorForm({ selection, canEdit, busy, onClose, onSave, buildSave, children, details, lifecycleLabel }: EditorFormProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const active = useRef(true)
  const dismissed = useRef(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const locked = busy || saving
  const close = () => {
    if (busy || pending.current || dismissed.current || !active.current) return
    dismissed.current = true
    onClose()
  }
  const perform = async (build: () => EditorSave) => {
    if (!active.current || dismissed.current || busy || pending.current || !canEdit) return
    let payload: EditorSave
    try { payload = build() } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Review the fields before saving.')
      return
    }
    pending.current = true
    setSaving(true)
    setError('')
    try { await onSave(payload) }
    catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : 'The update could not be saved.') }
    finally {
      pending.current = false
      if (active.current) setSaving(false)
    }
  }
  const kind = selection.kind === 'type' ? 'activity type' : selection.kind
  const title = selection.id === null ? `New ${kind}` : `${canEdit ? 'Edit' : 'Details:'} ${kind}`
  return <Dialog title={title} busy={locked} onClose={close} className="pp-editor-dialog">
    <form id="editor-form" onInvalidCapture={event => {
      const control = event.target
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) setError(control.validationMessage)
    }} onSubmit={event => {
      event.preventDefault()
      const submitter = (event.nativeEvent as SubmitEvent).submitter
      const intent = submitter instanceof HTMLButtonElement && submitter.value === 'lifecycle' ? 'lifecycle' : 'save'
      void perform(() => buildSave(intent))
    }}>
      <fieldset className="pp-editor-fields" disabled={!canEdit || locked}>{children(!canEdit || locked)}</fieldset>
      {details?.(locked)}
      {error && <p className="pp-field-error" role="alert">{error}</p>}
      <div className="pp-dialog-actions">
        {canEdit && selection.id !== null && <button id="delete-item" type="button" className="pp-button pp-danger" disabled={locked} onClick={() => {
          if (!canEdit || locked || pending.current || dismissed.current || !active.current) return
          if (window.confirm(`Delete this ${kind}?`)) void perform(() => deleteEditorState(selection))
        }}>Delete</button>}
        <button id="cancel-editor" type="button" className="pp-button" disabled={locked} onClick={close}>Cancel</button>
        {canEdit && <button type="submit" className="pp-button pp-primary" disabled={locked} value="save">{locked ? 'Saving…' : 'Save'}</button>}
        {canEdit && lifecycleLabel && <button type="submit" className="pp-button" value="lifecycle" disabled={locked}>{lifecycleLabel}</button>}
      </div>
    </form>
  </Dialog>
}
