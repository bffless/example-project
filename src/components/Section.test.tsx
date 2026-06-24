import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Section, Dot } from './Section'

describe('Section', () => {
  it('renders children', () => {
    render(
      <Section>
        <p>body content</p>
      </Section>,
    )
    expect(screen.getByText('body content')).toBeInTheDocument()
  })

  it('renders the eyebrow and title when provided', () => {
    render(
      <Section eyebrow="— Watch" title="A heading">
        <p>x</p>
      </Section>,
    )
    expect(screen.getByText('— Watch')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'A heading' })).toBeInTheDocument()
  })

  it('omits the header block when neither eyebrow nor title is given', () => {
    render(
      <Section>
        <p>only body</p>
      </Section>,
    )
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('renders the bottom divider by default and drops it when divider is false', () => {
    const { container, rerender } = render(
      <Section>
        <p>a</p>
      </Section>,
    )
    expect(container.querySelector('section')).toHaveClass('border-b')

    rerender(
      <Section divider={false}>
        <p>a</p>
      </Section>,
    )
    expect(container.querySelector('section')).not.toHaveClass('border-b')
  })

  it('applies a custom className to the inner container', () => {
    const { container } = render(
      <Section className="custom-class">
        <p>a</p>
      </Section>,
    )
    expect(container.querySelector('.custom-class')).toBeInTheDocument()
  })
})

describe('Dot', () => {
  it('renders a terracotta period', () => {
    const { container } = render(<Dot />)
    expect(container.textContent).toBe('.')
    expect(container.querySelector('span')).toHaveClass('text-terracotta')
  })
})
