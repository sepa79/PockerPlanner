import { useState } from 'react'
import type { PlannerApi } from '../api/plannerApi'
import type { Activity, EditorSave, EditorSelection } from '../api/types'
import { Dialog } from './Dialog'
import { EditorActivity } from './EditorActivity'
import { EditorDetails } from './EditorDetails'
import { editorItem, editorPlan } from './EditorState'
import './Editor.css'

export interface EditorProps {
  selection: EditorSelection
  canEdit: boolean
  busy: boolean
  onClose: () => void
  onSave: (payload: EditorSave) => Promise<void>
  api: PlannerApi
}

function EditorSnapshot(props: EditorProps) {
  const [selection] = useState(() => structuredClone(props.selection))
  let plan
  let item
  try {
    plan = editorPlan(selection)
    item = editorItem(selection)
    if (selection.id === null && !props.canEdit) throw new Error('Sign in as a PocketHive local-admin to create an item.')
    if (selection.kind === 'activity' && (!plan?.streams.length || !plan.activityTypes.length)) throw new Error('Add a stream and an activity type before creating an activity.')
  } catch (failure) {
    return <Dialog title="Details unavailable" busy={props.busy} onClose={props.onClose}>
      <p role="alert">{failure instanceof Error ? failure.message : 'The selected item is unavailable.'}</p>
      <button type="button" className="pp-button" disabled={props.busy} onClick={props.onClose}>Cancel</button>
    </Dialog>
  }
  const common = { ...props, selection }
  return selection.kind === 'activity'
    ? <EditorActivity {...common} plan={plan!} original={item as Activity | null} />
    : <EditorDetails {...common} plan={plan} original={item} />
}

export function Editor(props: EditorProps) {
  return <EditorSnapshot key={JSON.stringify([props.selection.kind, props.selection.planId, props.selection.id])} {...props} />
}

export default Editor
