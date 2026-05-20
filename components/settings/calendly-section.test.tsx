// ============================================================
// TESTS — CalendlySection (GLN-120)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CalendlySection } from './calendly-section'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('CalendlySection', () => {
  it('rend l\'URL initiale dans l\'input', () => {
    render(<CalendlySection initialUrl="https://calendly.com/samir/30min" />)
    const input = screen.getByPlaceholderText(/calendly.com/i) as HTMLInputElement
    expect(input.value).toBe('https://calendly.com/samir/30min')
  })

  it('autorise une URL Calendly valide', () => {
    render(<CalendlySection initialUrl="" />)
    const input = screen.getByPlaceholderText(/calendly.com/i) as HTMLInputElement
    fireEvent.change(input, {
      target: { value: 'https://calendly.com/samir/30min' },
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('autorise une URL Cal.com valide', () => {
    render(<CalendlySection initialUrl="" />)
    const input = screen.getByPlaceholderText(/calendly.com/i) as HTMLInputElement
    fireEvent.change(input, {
      target: { value: 'https://cal.com/samir' },
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('signale une URL invalide (autre domaine)', () => {
    render(<CalendlySection initialUrl="" />)
    const input = screen.getByPlaceholderText(/calendly.com/i)
    fireEvent.change(input, {
      target: { value: 'https://example.com/booking' },
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/calendly\.com/i)
  })

  it('signale une URL HTTP (non-HTTPS) comme invalide', () => {
    render(<CalendlySection initialUrl="" />)
    const input = screen.getByPlaceholderText(/calendly.com/i)
    fireEvent.change(input, {
      target: { value: 'http://calendly.com/samir/30min' },
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/calendly\.com/i)
  })

  it('considère une chaîne vide comme valide (= URL pas configurée)', () => {
    render(<CalendlySection initialUrl="" />)
    const input = screen.getByPlaceholderText(/calendly.com/i)
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('appelle PATCH /api/profile/settings avec l\'URL au submit', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 200 }),
    )
    render(<CalendlySection initialUrl="https://calendly.com/samir/30min" />)
    const submit = screen.getByRole('button', { name: /enregistrer/i })
    fireEvent.click(submit)
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/profile/settings',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.calendly_url).toBe('https://calendly.com/samir/30min')
  })

  it('affiche le bouton "Tester" quand l\'URL est valide et non vide', () => {
    render(<CalendlySection initialUrl="https://calendly.com/samir/30min" />)
    const tester = screen.getByRole('link', { name: /tester/i })
    expect(tester).toHaveAttribute('target', '_blank')
    expect(tester).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
