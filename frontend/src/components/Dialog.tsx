import { useEffect, useRef, type ReactNode } from 'react'

export interface DialogProps {
  title: string
  busy?: boolean
  onClose: () => void
  children: ReactNode
  id?: string
  className?: string
}

export function Dialog({ title, busy = false, onClose, children, id = 'editor', className = '' }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pressedOutside = useRef(false)
  const active = useRef(false)
  const dismissed = useRef(false)
  const close = () => {
    if (busy || !active.current || dismissed.current) return
    dismissed.current = true
    pressedOutside.current = false
    onClose()
  }
  useEffect(() => {
    const dialog = dialogRef.current!
    active.current = true
    dismissed.current = false
    dialog.showModal()
    return () => {
      active.current = false
      pressedOutside.current = false
      dialog.close()
    }
  }, [])
  const outside = (event: { target: EventTarget; clientX: number; clientY: number }) => {
    const dialog = dialogRef.current!
    const bounds = dialog.getBoundingClientRect()
    return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)
  }
  return <dialog id={id} ref={dialogRef} className={`pp-dialog ${className}`} aria-labelledby={`${id}-title`} aria-busy={busy}
    onCancel={event => { event.preventDefault(); close() }} onClose={() => { pressedOutside.current = false; if (!dialogRef.current?.open) close() }}
    onPointerDown={event => { pressedOutside.current = event.isPrimary && event.button === 0 && outside(event) }}
    onPointerCancel={() => { pressedOutside.current = false }}
    onClick={event => {
      const dismiss = pressedOutside.current && event.button === 0 && outside(event)
      pressedOutside.current = false
      if (event.target === dialogRef.current) event.stopPropagation()
      if (dismiss) close()
    }}>
    <header className="pp-dialog-heading"><h2 id={`${id}-title`}>{title}</h2>
      <button type="button" className="pp-button" aria-label="Close dialog" disabled={busy} onClick={close}>×</button>
    </header>
    {children}
  </dialog>
}

export default Dialog
