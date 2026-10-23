import { StrictMode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'
import { mockDialogs } from './Editor.testSupport'

beforeEach(mockDialogs)

function press(dialog: HTMLDialogElement, options: { inside?: boolean; primary?: boolean; button?: number } = {}) {
  const event = new MouseEvent('pointerdown', { bubbles: true, clientX: options.inside ? 150 : 5, clientY: options.inside ? 150 : 5, button: options.button ?? 0 })
  Object.defineProperty(event, 'isPrimary', { value: options.primary ?? true })
  fireEvent(dialog, event)
}

describe('native dialog dismissal', () => {
  it('opens a labelled native modal and closes only after both primary press and click outside', () => {
    const onClose = vi.fn()
    render(<Dialog title="Activity details" onClose={onClose}><input aria-label="Inside" /></Dialog>)
    const dialog = screen.getByRole('dialog') as HTMLDialogElement
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 400, top: 100, bottom: 400 } as DOMRect)
    expect(dialog.open).toBe(true)
    expect(dialog).toHaveAccessibleName('Activity details')
    fireEvent.click(dialog, { clientX: 5, clientY: 5 })
    expect(onClose).not.toHaveBeenCalled()
    press(dialog, { inside: true })
    fireEvent.click(dialog, { clientX: 5, clientY: 5 })
    expect(onClose).not.toHaveBeenCalled()
    press(dialog)
    fireEvent.click(dialog, { clientX: 100, clientY: 150 })
    expect(onClose).not.toHaveBeenCalled()
    press(dialog)
    fireEvent.click(dialog, { clientX: 5, clientY: 5 })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it.each([{ primary: false }, { button: 1 }, { button: 2 }])('ignores nonprimary outside presses %o', options => {
    const onClose = vi.fn()
    render(<Dialog title="Details" onClose={onClose}>Content</Dialog>)
    const dialog = screen.getByRole('dialog') as HTMLDialogElement
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 400, top: 100, bottom: 400 } as DOMRect)
    press(dialog, options)
    fireEvent.click(dialog, { clientX: 5, clientY: 5 })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('clears cancelled presses and blocks Escape, close and backdrop while busy', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Dialog title="Details" busy onClose={onClose}>Content</Dialog>)
    const dialog = screen.getByRole('dialog') as HTMLDialogElement
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 400, top: 100, bottom: 400 } as DOMRect)
    const cancel = new Event('cancel', { cancelable: true })
    fireEvent(dialog, cancel)
    expect(cancel.defaultPrevented).toBe(true)
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled()
    press(dialog)
    fireEvent.click(dialog, { clientX: 5, clientY: 5 })
    expect(onClose).not.toHaveBeenCalled()
    rerender(<Dialog title="Details" onClose={onClose}>Content</Dialog>)
    press(dialog)
    fireEvent.pointerCancel(dialog)
    fireEvent.click(dialog, { clientX: 5, clientY: 5 })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ignores delayed native cleanup-close events after StrictMode reopens the modal', () => {
    const onClose = vi.fn()
    render(<StrictMode><Dialog title="Details" onClose={onClose}>Content</Dialog></StrictMode>)
    fireEvent(screen.getByRole('dialog'), new Event('close'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
