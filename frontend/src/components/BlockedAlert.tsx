import { useEffect, useRef } from 'react'

export function BlockedAlert({ open, onAcknowledge, onShow }: { open: boolean; onAcknowledge: () => void; onShow: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current!; if (open && !dialog.open) dialog.showModal(); else if (!open && dialog.open) dialog.close() }, [open])
  return <dialog ref={ref} className="pp-blocked-alert" aria-labelledby="blocked-title" onCancel={event => event.preventDefault()}>
    <h2 id="blocked-title">BLOCKED!</h2><p>Every unfinished activity in this plan is blocked.</p><div className="pp-actions"><button className="pp-primary" onClick={onAcknowledge}>Acknowledged</button><button onClick={onShow}>Show me the blockers</button></div>
  </dialog>
}
