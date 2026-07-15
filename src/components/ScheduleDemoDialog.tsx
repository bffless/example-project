import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import './ContactDialog.css'

type Props = {
  open: boolean
  onClose: () => void
}

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function ScheduleDemoDialog({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const triggerRef = useRef<Element | null>(null)

  useEffect(() => {
    const dlg = dialogRef.current
    if (!dlg) return
    if (open && !dlg.open) {
      triggerRef.current = document.activeElement
      dlg.showModal()
    } else if (!open && dlg.open) {
      dlg.close()
    }
  }, [open])

  const handleCancel = (e: Event) => {
    e.preventDefault()
    onClose()
  }
  const handleClose = () => {
    const trigger = triggerRef.current as HTMLElement | null
    trigger?.focus?.()
  }

  useEffect(() => {
    const dlg = dialogRef.current
    if (!dlg) return
    dlg.addEventListener('cancel', handleCancel)
    dlg.addEventListener('close', handleClose)
    return () => {
      dlg.removeEventListener('cancel', handleCancel)
      dlg.removeEventListener('close', handleClose)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className="contact-dialog"
      onClick={handleBackdropClick}
    >
      {open && <ScheduleDemoDialogBody formRef={formRef} onClose={onClose} />}
    </dialog>
  )
}

function ScheduleDemoDialogBody({
  formRef,
  onClose,
}: {
  formRef: React.RefObject<HTMLFormElement | null>
  onClose: () => void
}) {
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (status !== 'success') return
    const t = setTimeout(() => {
      onClose()
      setStatus('idle')
    }, 1500)
    return () => clearTimeout(t)
  }, [status, onClose])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('submitting')
    setErrorMessage(null)
    try {
      const fd = new FormData(e.currentTarget)
      const payload: Record<string, unknown> = {
        name: fd.get('name'),
        email: fd.get('email'),
      }
      for (const field of ['company', 'preferred_date', 'preferred_time', 'notes']) {
        const value = fd.get(field)
        if (typeof value === 'string' && value.trim()) payload[field] = value
      }

      const res = await fetch('/api/demo-requests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        throw new Error(`Submit failed (${res.status})`)
      }
      setStatus('success')
      formRef.current?.reset()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
    }
  }

  return (
    <>
      <header className="contact-dialog__header">
        <h2>Schedule a demo</h2>
        <button
          type="button"
          className="contact-dialog__close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <form ref={formRef} onSubmit={onSubmit} noValidate={false}>
        <div className="contact-dialog__body">
          <div className="contact-dialog__field">
            <label htmlFor="demo-name">Name</label>
            <input id="demo-name" name="name" type="text" required autoFocus />
          </div>
          <div className="contact-dialog__field">
            <label htmlFor="demo-email">Email</label>
            <input id="demo-email" name="email" type="email" required />
          </div>
          <div className="contact-dialog__field">
            <label htmlFor="demo-company">Company (optional)</label>
            <input id="demo-company" name="company" type="text" />
          </div>
          <div className="contact-dialog__field">
            <label htmlFor="demo-date">Preferred date (optional)</label>
            <input id="demo-date" name="preferred_date" type="date" />
          </div>
          <div className="contact-dialog__field">
            <label htmlFor="demo-time">Preferred time (optional)</label>
            <input id="demo-time" name="preferred_time" type="time" />
          </div>
          <div className="contact-dialog__field">
            <label htmlFor="demo-notes">Notes (optional)</label>
            <textarea id="demo-notes" name="notes" />
          </div>
        </div>
        <footer className="contact-dialog__footer">
          <span
            className={
              'contact-dialog__status' +
              (status === 'error' ? ' is-error' : '') +
              (status === 'success' ? ' is-success' : '')
            }
            role={status === 'error' ? 'alert' : undefined}
          >
            {status === 'submitting' && 'Sending…'}
            {status === 'success' && "Thanks — we'll be in touch to confirm."}
            {status === 'error' && errorMessage}
          </span>
          <button
            type="submit"
            className="contact-dialog__submit"
            disabled={status === 'submitting'}
          >
            Request demo
          </button>
        </footer>
      </form>
    </>
  )
}
