import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatInput } from './ChatInput'

function setup(props: Partial<Parameters<typeof ChatInput>[0]> = {}) {
  const onChange = vi.fn()
  const onSend = vi.fn()
  const onStop = vi.fn()
  render(
    <ChatInput
      value={props.value ?? ''}
      onChange={props.onChange ?? onChange}
      onSend={props.onSend ?? onSend}
      onStop={props.onStop ?? onStop}
      status={props.status ?? 'ready'}
      disabled={props.disabled}
      rateLimitCountdown={props.rateLimitCountdown}
    />,
  )
  return { onChange, onSend, onStop }
}

describe('ChatInput', () => {
  it('calls onChange as the user types', () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByPlaceholderText('Type a message'), {
      target: { value: 'hello' },
    })
    expect(onChange).toHaveBeenCalledWith('hello')
  })

  it('sends on Enter when there is trimmed content', () => {
    const { onSend } = setup({ value: 'hi' })
    fireEvent.keyDown(screen.getByPlaceholderText('Type a message'), { key: 'Enter' })
    expect(onSend).toHaveBeenCalled()
  })

  it('does not send on Shift+Enter', () => {
    const { onSend } = setup({ value: 'hi' })
    fireEvent.keyDown(screen.getByPlaceholderText('Type a message'), {
      key: 'Enter',
      shiftKey: true,
    })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('does not send on Enter when the value is empty', () => {
    const { onSend } = setup({ value: '   ' })
    fireEvent.keyDown(screen.getByPlaceholderText('Type a message'), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('does not send on Enter while streaming', () => {
    const { onSend } = setup({ value: 'hi', status: 'streaming' })
    fireEvent.keyDown(screen.getByPlaceholderText('Type a message'), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('the send button is disabled with no content', () => {
    setup({ value: '' })
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('clicking the send button sends when content is present', () => {
    const { onSend } = setup({ value: 'hi' })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalled()
  })

  it('shows a Stop button while streaming and calls onStop', () => {
    const { onStop } = setup({ value: 'hi', status: 'streaming' })
    const stop = screen.getByRole('button', { name: 'Stop' })
    fireEvent.click(stop)
    expect(onStop).toHaveBeenCalled()
  })

  it('renders the rate-limit countdown notice', () => {
    setup({ rateLimitCountdown: 7 })
    expect(screen.getByText(/Rate limited — try again in 7s/)).toBeInTheDocument()
  })

  it('disables the textarea when disabled', () => {
    setup({ disabled: true })
    expect(screen.getByPlaceholderText('Type a message')).toBeDisabled()
  })
})
