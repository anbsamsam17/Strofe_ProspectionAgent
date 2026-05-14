// ============================================================
// Tests : SectionErrorFallback
// ------------------------------------------------------------
// Couvre :
//   - Rendu nominal sans message (juste la section).
//   - Rendu avec message d'erreur affiché en monospace.
//   - A11y : role="alert" + aria-label dérivé de `section`.
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { SectionErrorFallback } from './section-error-fallback'

afterEach(() => {
  cleanup()
})

describe('SectionErrorFallback', () => {
  it('rend le titre avec le nom de la section', () => {
    render(<SectionErrorFallback section="KPIs" />)
    expect(
      screen.getByRole('heading', { name: /Section KPIs indisponible/i }),
    ).toBeInTheDocument()
  })

  it("expose role='alert' et un aria-label dérivé de section", () => {
    render(<SectionErrorFallback section="Activité agent" />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute(
      'aria-label',
      'Section Activité agent indisponible',
    )
  })

  it("affiche un message d'erreur en monospace quand fourni", () => {
    render(
      <SectionErrorFallback
        section="Kanban"
        message="TypeError: Cannot read properties of undefined"
      />,
    )
    const msg = screen.getByText(/TypeError: Cannot read properties of undefined/)
    expect(msg).toBeInTheDocument()
    // La classe font-mono est appliquée pour rendre le diagnostic lisible.
    expect(msg.className).toMatch(/font-mono/)
  })

  it("n'affiche pas de bloc message quand `message` est absent", () => {
    const { container } = render(<SectionErrorFallback section="KPIs" />)
    // Seuls le h2 + le paragraphe générique doivent être rendus, pas de 3e <p>.
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1)
  })

  it('reste utilisable avec un message vide string (rendu identique à absent)', () => {
    const { container } = render(
      <SectionErrorFallback section="KPIs" message="" />,
    )
    // String vide est falsy → le bloc message n'est pas rendu.
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1)
  })
})
