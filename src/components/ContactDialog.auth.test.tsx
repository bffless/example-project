import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ContactDialog } from './ContactDialog'

// Authenticated session so the attachment/upload branch is exercised.
vi.mock('../lib/useSession', () => ({
  useSession: () => ({
    session: { authenticated: true, user: { id: 'u-1' } },
    loading: false,
    refetch: vi.fn(),
  }),
}))

// jsdom's native `new FormData(form)` clones file inputs into a fresh File whose
// `size` is always 0, which would make the component's `file.size > 0` upload
// guard impossible to satisfy. This faithful stub reads the input's actual File
// (size intact) so the authenticated upload path is testable.
class TestFormData {
  private map = new Map<string, FormDataEntryValue>()
  constructor(form?: HTMLFormElement) {
    if (form) {
      for (const el of Array.from(form.elements) as HTMLInputElement[]) {
        if (!el.name) continue
        if (el.type === 'file') {
          if (el.files && el.files.length) this.map.set(el.name, el.files[0])
        } else if (el.type !== 'submit' && el.type !== 'button') {
          this.map.set(el.name, el.value)
        }
      }
    }
  }
  get(key: string): FormDataEntryValue | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  append(key: string, value: FormDataEntryValue) {
    this.map.set(key, value)
  }
}

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '')
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open')
    }
  }
  vi.stubGlobal('FormData', TestFormData)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function fillBaseFields() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } })
}

function attachFile(file: File) {
  const input = screen.getByLabelText(/Attachment/) as HTMLInputElement
  // Assign a FileList-like object so the form's file input exposes the File
  // (TestFormData reads `input.files[0]`).
  const fileList = {
    0: file,
    length: 1,
    item: (i: number) => (i === 0 ? file : null),
    [Symbol.iterator]: function* () {
      yield file
    },
  }
  Object.defineProperty(input, 'files', { value: fileList, configurable: true })
}

describe('ContactDialog (authenticated)', () => {
  it('shows the attachment field for authenticated users', () => {
    render(<ContactDialog open={true} onClose={vi.fn()} />)
    expect(screen.getByLabelText(/Attachment/)).toBeInTheDocument()
  })

  it('includes the optional phone in the payload when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ContactDialog open={true} onClose={vi.fn()} />)
    fillBaseFields()
    fireEvent.change(screen.getByLabelText('Phone (optional)'), { target: { value: '555-1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.phone).toBe('555-1234')
  })

  it('uploads the attachment first then posts the attachment_url', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: 'https://cdn.test/file.pdf' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ContactDialog open={true} onClose={vi.fn()} />)
    fillBaseFields()
    attachFile(new File(['data'], 'file.pdf', { type: 'application/pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/uploads/contact-attachments')
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(body.attachment_url).toBe('https://cdn.test/file.pdf')
  })

  it('reads the url from a nested data field in the upload response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { url: 'https://cdn.test/nested.png' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ContactDialog open={true} onClose={vi.fn()} />)
    fillBaseFields()
    attachFile(new File(['x'], 'nested.png', { type: 'image/png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(body.attachment_url).toBe('https://cdn.test/nested.png')
  })

  it('reports an error when the upload fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ContactDialog open={true} onClose={vi.fn()} />)
    fillBaseFields()
    attachFile(new File(['x'], 'file.pdf', { type: 'application/pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Upload failed \(500\)/),
    )
    // The contact POST is never reached.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports an error when the upload response has no url', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ContactDialog open={true} onClose={vi.fn()} />)
    fillBaseFields()
    attachFile(new File(['x'], 'file.pdf', { type: 'application/pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Upload response missing url/),
    )
  })

  it('rejects an attachment larger than 10 MB before uploading', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<ContactDialog open={true} onClose={vi.fn()} />)
    fillBaseFields()
    const bigFile = new File(['x'], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(bigFile, 'size', { value: 11 * 1024 * 1024 })
    attachFile(bigFile)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Attachment must be 10 MB or smaller/),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
