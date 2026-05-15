// ============================================================
// Tests : QuotaWidget
// ------------------------------------------------------------
// Couvre :
//   - 4 rows rendues (1 par provider).
//   - Quota épuisé → texte "Épuisé" + ring rouge.
//   - Quota > 80 % → ring jaune + emoji ⚠️.
//   - Chaque progressbar a un aria-label complet.
//   - Footer "Reset le 1er du mois" présent.
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'

import { QuotaWidget, type QuotaState } from './quota-widget'

afterEach(() => cleanup())

const QUOTAS: QuotaState[] = [
  { provider: 'pappers', used: 23, remaining: 77, limit: 100, exhausted: false },
  { provider: 'hunter', used: 5, remaining: 20, limit: 25, exhausted: false },
  { provider: 'inpi', used: 18, remaining: 9982, limit: 10000, exhausted: false },
  { provider: 'google_cse', used: 0, remaining: 3000, limit: 3000, exhausted: false },
]

describe('QuotaWidget — rendu nominal', () => {
  it('rend 4 rows (une par provider)', () => {
    render(<QuotaWidget quotas={QUOTAS} />)
    const bars = screen.getAllByRole('progressbar')
    expect(bars).toHaveLength(4)
    expect(screen.getByText('Pappers')).toBeInTheDocument()
    expect(screen.getByText('Hunter')).toBeInTheDocument()
    expect(screen.getByText('INPI')).toBeInTheDocument()
    expect(screen.getByText('Google CSE')).toBeInTheDocument()
  })

  it('affiche les compteurs used/limit en mono', () => {
    render(<QuotaWidget quotas={QUOTAS} />)
    expect(screen.getByText('23/100')).toBeInTheDocument()
    expect(screen.getByText('5/25')).toBeInTheDocument()
    expect(screen.getByText('18/10000')).toBeInTheDocument()
    expect(screen.getByText('0/3000')).toBeInTheDocument()
  })

  it('affiche les "rest." pour les providers non illimités', () => {
    render(<QuotaWidget quotas={QUOTAS} />)
    expect(screen.getByText('77 rest.')).toBeInTheDocument()
    expect(screen.getByText('20 rest.')).toBeInTheDocument()
    expect(screen.getByText('3000 rest.')).toBeInTheDocument()
  })

  it('INPI est marqué "illim." (pas de quota officiel)', () => {
    render(<QuotaWidget quotas={QUOTAS} />)
    expect(screen.getByText('illim.')).toBeInTheDocument()
  })

  it('footer "Reset le 1er du mois" présent', () => {
    render(<QuotaWidget quotas={QUOTAS} />)
    expect(screen.getByText(/Reset le 1er du mois/i)).toBeInTheDocument()
  })
})

describe('QuotaWidget — a11y progressbar', () => {
  it('chaque progressbar porte un aria-label complet (label + valeurs)', () => {
    render(<QuotaWidget quotas={QUOTAS} />)
    const pappersBar = screen.getByRole('progressbar', {
      name: /Quota Pappers.*23.*100.*77/i,
    })
    expect(pappersBar).toBeInTheDocument()
    expect(pappersBar).toHaveAttribute('aria-valuenow', '23')
    expect(pappersBar).toHaveAttribute('aria-valuemax', '100')
    expect(pappersBar).toHaveAttribute('aria-valuemin', '0')
  })
})

describe('QuotaWidget — alerte > 80 %', () => {
  it('row Hunter à 22/25 (88 %) déclenche la classe ring-yellow + ⚠️', () => {
    const warningQuotas: QuotaState[] = [
      ...QUOTAS.slice(0, 1),
      { provider: 'hunter', used: 22, remaining: 3, limit: 25, exhausted: false },
      ...QUOTAS.slice(2),
    ]
    const { container } = render(<QuotaWidget quotas={warningQuotas} />)
    const hunterRow = container.querySelector(
      'li[data-provider="hunter"]',
    ) as HTMLElement | null
    expect(hunterRow).not.toBeNull()
    expect(hunterRow?.getAttribute('data-state')).toBe('warning')
    expect(hunterRow?.className).toContain('ring-yellow-500/60')
    // L'emoji ⚠️ est rendu dans la zone label
    expect(within(hunterRow as HTMLElement).getByText('⚠️')).toBeInTheDocument()
  })
})

describe('QuotaWidget — quota épuisé', () => {
  it('exhausted=true → texte "Épuisé" + ring rouge + dot pulsant', () => {
    const exhaustedQuotas: QuotaState[] = [
      { provider: 'pappers', used: 100, remaining: 0, limit: 100, exhausted: true },
      ...QUOTAS.slice(1),
    ]
    const { container } = render(<QuotaWidget quotas={exhaustedQuotas} />)
    const pappersRow = container.querySelector(
      'li[data-provider="pappers"]',
    ) as HTMLElement | null
    expect(pappersRow).not.toBeNull()
    expect(pappersRow?.getAttribute('data-state')).toBe('exhausted')
    expect(pappersRow?.className).toContain('ring-red-500/60')
    expect(within(pappersRow as HTMLElement).getByText('Épuisé')).toBeInTheDocument()
    // Dot pulsant : un span rouge avec animate-pulse
    const dot = pappersRow?.querySelector('span.animate-pulse')
    expect(dot).not.toBeNull()
  })
})
