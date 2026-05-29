import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useSession } from '../lib/useSession'
import './ContactDialog.css'

type Props = {
  open: boolean
  onClose: () => void
}

type Status = 'idle' | 'submitting' | 'success' | 'error'

const MAX_FILE_BYTES = 10 * 1024 * 1024

export function ContactDialog({ open, onClose }: Props) {
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
      {open && <ContactDialogBody formRef={formRef} onClose={onClose} />}
    </dialog>
  )
}

function ContactDialogBody({
  formRef,
  onClose,
}: {
  formRef: React.RefObject<HTMLFormElement | null>
  onClose: () => void
}) {
  const { session, loading } = useSession()
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const authenticated = session?.authenticated === true

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
      let attachment_url: string | undefined

      const file = fd.get('attachment')
      if (file instanceof File && file.size > 0 && authenticated) {
        if (file.size > MAX_FILE_BYTES) {
          throw new Error('Attachment must be 10 MB or smaller')
        }
        const upFd = new FormData()
        upFd.append('file', file)
        const upRes = await fetch('/api/uploads/contact-attachments', {
          method: 'POST',
          credentials: 'include',
          body: upFd,
        })
        if (!upRes.ok) {
          throw new Error(`Upload failed (${upRes.status})`)
        }
        const upJson = (await upRes.json()) as {
          url?: string
          data?: { url?: string }
          record?: { url?: string }
        }
        attachment_url =
          upJson.url ?? upJson.data?.url ?? upJson.record?.url
        if (!attachment_url) {
          throw new Error('Upload response missing url')
        }
      }

      const payload: Record<string, unknown> = {
        name: fd.get('name'),
        email: fd.get('email'),
        comment: fd.get('comment'),
      }
      const phone = fd.get('phone')
      if (typeof phone === 'string' && phone.trim()) payload.phone = phone
      if (attachment_url) payload.attachment_url = attachment_url

      const res = await fetch('/api/contact', {
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
        <h2>Contact us</h2>
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
            <label htmlFor="contact-name">Name</label>
            <input id="contact-name" name="name" type="text" required autoFocus />
          </div>
          <div className="contact-dialog__field">
            <label htmlFor="contact-email">Email</label>
            <input id="contact-email" name="email" type="email" required />
          </div>
          <div className="contact-dialog__field">
            <label htmlFor="contact-phone">Phone (optional)</label>
            <input id="contact-phone" name="phone" type="tel" />
          </div>
          <div className="contact-dialog__field">
            <label htmlFor="contact-comment">Message</label>
            <textarea id="contact-comment" name="comment" required />
          </div>
          {!loading && authenticated && (
            <div className="contact-dialog__upload">
              <label htmlFor="contact-attachment">Attachment (optional)</label>
              <input
                id="contact-attachment"
                name="attachment"
                type="file"
                accept="image/*,application/pdf"
              />
              <span className="contact-dialog__hint">
                Image or PDF, up to 10 MB
              </span>
            </div>
          )}
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
            {status === 'success' && 'Thanks — we got your message.'}
            {status === 'error' && errorMessage}
          </span>
          <button
            type="submit"
            className="contact-dialog__submit"
            disabled={status === 'submitting'}
          >
            Send
          </button>
        </footer>
      </form>
    </>
  )
}
