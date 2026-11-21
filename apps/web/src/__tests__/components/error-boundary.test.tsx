// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@/components/error-boundary'

const mocks = vi.hoisted(() => ({ captureException: vi.fn() }))

vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
}))

let shouldThrow = true

function TestSection() {
  if (shouldThrow) throw new Error('section failed')
  return <p>Section recovered</p>
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = true
    mocks.captureException.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('shows a scoped retry fallback and reports the error to Sentry', () => {
    render(
      <ErrorBoundary inline label="Certificate table">
        <TestSection />
      </ErrorBoundary>
    )

    expect(screen.getByRole('alert').textContent).toContain('Certificate table failed to load.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(mocks.captureException).toHaveBeenCalledOnce()
    expect(mocks.captureException.mock.calls[0][0].message).toBe('section failed')
  })

  it('retries rendering its section', () => {
    render(
      <ErrorBoundary inline label="Meter list">
        <TestSection />
      </ErrorBoundary>
    )

    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(screen.getByText('Section recovered')).toBeTruthy()
  })

  it('renders a friendly full-page fallback with recovery options', () => {
    render(
      <ErrorBoundary>
        <TestSection />
      </ErrorBoundary>
    )

    expect(screen.getByRole('alert').textContent).toContain('Something went wrong')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /report issue/i })).toBeTruthy()
    expect(mocks.captureException).toHaveBeenCalledOnce()
    expect(mocks.captureException.mock.calls[0][0].message).toBe('section failed')
  })

  it('resets the boundary and re-renders the recovered child without a page reload', () => {
    const reload = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    })

    try {
      render(
        <ErrorBoundary>
          <TestSection />
        </ErrorBoundary>
      )

      shouldThrow = false
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      expect(screen.getByText('Section recovered')).toBeTruthy()
      expect(reload).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      })
    }
  })

  it('links to a prefilled GitHub issue containing the error message and stack', () => {
    render(
      <ErrorBoundary>
        <TestSection />
      </ErrorBoundary>
    )

    const link = screen.getByRole('link', { name: /report issue/i })
    const href = link.getAttribute('href') ?? ''

    expect(href).toContain('https://github.com/')
    expect(href).toContain('/issues/new')
    expect(href).toContain(encodeURIComponent('section failed'))
    expect(href).toContain(encodeURIComponent('Error: section failed'))
  })
})