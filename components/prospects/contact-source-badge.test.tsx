// ============================================================
// Tests : ContactSourceBadge
// ------------------------------------------------------------
// Couvre :
//   - Chaque source rendue avec sa classe couleur dédiée.
//   - Label visible correct (RE, INPI, BODACC, Pappers, Hunter, Pattern + DNS,
//     ADEME, Manuel).
//   - Tooltip natif `title` présent avec description complète.
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import {
  ContactSourceBadge,
  type ContactSource,
} from './contact-source-badge'

afterEach(() => cleanup())

interface Case {
  source: ContactSource
  label: string
  /** Substring qu'on s'attend à trouver dans la `className` (couleur). */
  colorMatch: string
  /** Substring distinctif attendu dans le tooltip. */
  tooltipMatch: RegExp
}

const CASES: Case[] = [
  { source: 're', label: 'RE', colorMatch: 'cyan', tooltipMatch: /Recherche Entreprises/i },
  { source: 'inpi', label: 'INPI', colorMatch: 'violet', tooltipMatch: /INPI/i },
  { source: 'bodacc', label: 'BODACC', colorMatch: 'blue', tooltipMatch: /BODACC/i },
  { source: 'pappers', label: 'Pappers', colorMatch: 'amber', tooltipMatch: /Pappers/i },
  {
    source: 'hunter-pattern',
    label: 'Hunter',
    colorMatch: 'orange',
    tooltipMatch: /Hunter\.io/i,
  },
  {
    source: 'pattern',
    label: 'Pattern + DNS',
    colorMatch: 'white',
    tooltipMatch: /pattern/i,
  },
  { source: 'ademe', label: 'ADEME', colorMatch: 'green', tooltipMatch: /ADEME/i },
  { source: 'manual', label: 'Manuel', colorMatch: 'white', tooltipMatch: /manuelle/i },
]

describe('ContactSourceBadge — rendu par source', () => {
  for (const c of CASES) {
    it(`source=${c.source} affiche le label "${c.label}" avec la couleur ${c.colorMatch}`, () => {
      render(<ContactSourceBadge source={c.source} />)
      const badge = screen.getByText(c.label)
      expect(badge).toBeInTheDocument()
      // La couleur est portée par la classe Tailwind translucide (bg-*-500/15 ou bg-white/[…]).
      expect(badge.className).toContain(c.colorMatch)
    })
  }
})

describe('ContactSourceBadge — tooltip', () => {
  it('expose un `title` descriptif pour chaque source', () => {
    for (const c of CASES) {
      cleanup()
      render(<ContactSourceBadge source={c.source} />)
      const badge = screen.getByText(c.label)
      expect(badge).toHaveAttribute('title')
      expect(badge.getAttribute('title') ?? '').toMatch(c.tooltipMatch)
    }
  })

  it('expose un `aria-label` descriptif (a11y screen reader)', () => {
    render(<ContactSourceBadge source="inpi" />)
    const badge = screen.getByLabelText(/INPI Registre National/i)
    expect(badge).toBeInTheDocument()
  })
})

describe('ContactSourceBadge — pattern visuel', () => {
  it('pattern (non vérifié) est rendu en italique', () => {
    render(<ContactSourceBadge source="pattern" />)
    const badge = screen.getByText('Pattern + DNS')
    expect(badge.className).toContain('italic')
  })
})
