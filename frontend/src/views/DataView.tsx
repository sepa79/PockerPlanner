import { useState } from 'react'
import type { EditorSave, Plan, Workspace } from '../api/types'
import { message } from '../hooks/useWorkspace'

export function exportFilename(name: string) {
  const sanitized = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/[. ]+$/, '') || 'pocketplanner-plan'
  return `${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sanitized) ? '_' : ''}${sanitized}.json`
}

export function DataView({ workspace, selected, canEdit, busy, onBusyChange, onSave }: {
  workspace: Workspace; selected: Plan | null; canEdit: boolean; busy: boolean; onBusyChange: (busy: boolean) => void; onSave: (save: EditorSave) => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [feedback, setFeedback] = useState('')
  const [reading, setReading] = useState(false)
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...workspace, revision: 0 })], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = exportFilename(selected?.name ?? '')
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function importFile() {
    if (!file || busy || reading) return
    if (file.size > 1024 * 1024) { setFeedback('The JSON file must be no larger than 1 MiB.'); return }
    setReading(true)
    onBusyChange(true)
    try {
      const value: unknown = JSON.parse(await file.text())
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a workspace JSON object.')
      if (!window.confirm('Replace all current plans with this JSON file?')) return
      await onSave({ endpoint: 'import', document: { ...value, revision: workspace.revision } as Workspace })
      setFeedback('Workspace imported and saved.')
    } catch (failure) { setFeedback(`Import failed: ${message(failure)}`) }
    finally { setReading(false); onBusyChange(false) }
  }
  return <section className="pp-panel" aria-label="Workspace JSON"><div className="pp-panel-toolbar"><h2>Data</h2></div><div className="pp-data-grid">
    <div className="pp-data-card"><h3>Export workspace</h3><p className="pp-muted">All plans as compact JSON. The filename follows the selected plan; the content includes every plan.</p><button id="export-json" onClick={download} disabled={busy || reading}>Export JSON</button></div>
    <div className="pp-data-card"><h3>Import workspace</h3><p className="pp-muted">Replaces every plan after confirmation. Stable IDs and manual execution facts remain in the JSON; the server validates the complete workspace.</p>
      <label>Workspace file<input type="file" accept="application/json,.json" disabled={!canEdit || busy || reading} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
      <button className="pp-primary" disabled={!canEdit || busy || reading || !file} onClick={() => { void importFile() }}>{reading || busy ? 'Importing…' : 'Import JSON'}</button>
      {!canEdit ? <p className="pp-muted">Sign in as PocketHive local-admin to import.</p> : null}
    </div>
    {feedback ? <p role="status" className="pp-description">{feedback}</p> : null}
  </div></section>
}
