import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ScheduleDemoDialog } from './ScheduleDemoDialog'

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
})

function fillRequired() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
}

describe('ScheduleDemoDialog', () => {
  it('renders the form fields when open', () => {
    render(<ScheduleDemoDialog open={true} onClose={vi.fn()} />)

    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Company (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Preferred date (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Preferred time (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Notes (optional)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request demo' })).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<ScheduleDemoDialog open={true} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('submits only the required fields when the optional ones are empty', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ScheduleDemoDialog open={true} onClose={vi.fn()} />)
    fillRequired()
    fireEvent.click(screen.getByRole('button', { name: 'Request demo' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/demo-requests')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ name: 'Ada', email: 'ada@example.com' })

    await waitFor(() =>
      expect(screen.getByText(/Thanks — we'll be in touch to confirm\./)).toBeInTheDocument(),
    )
  })

  it('includes the optional fields when they are filled in', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ScheduleDemoDialog open={true} onClose={vi.fn()} />)
    fillRequired()
    fireEvent.change(screen.getByLabelText('Company (optional)'), {
      target: { value: 'Analytical Engines Ltd' },
    })
    fireEvent.change(screen.getByLabelText('Preferred date (optional)'), {
      target: { value: '2026-08-01' },
    })
    fireEvent.change(screen.getByLabelText('Preferred time (optional)'), {
      target: { value: '14:30' },
    })
    fireEvent.change(screen.getByLabelText('Notes (optional)'), {
      target: { value: 'Interested in pipelines' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Request demo' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
      company: 'Analytical Engines Ltd',
      preferred_date: '2026-08-01',
      preferred_time: '14:30',
      notes: 'Interested in pipelines',
    })
  })

  it('shows an error message when the submit fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ScheduleDemoDialog open={true} onClose={vi.fn()} />)
    fillRequired()
    fireEvent.click(screen.getByRole('button', { name: 'Request demo' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Submit failed \(500\)/),
    )
  })
})
