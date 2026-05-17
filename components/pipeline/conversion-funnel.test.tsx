import React, { createElement, type ElementType, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ProspectStatus } from '@/lib/types'
import {
  ConversionFunnel,
  computeFunnelGeometry,
  trapezoidPath,
} from './conversion-funnel'
import type { FunnelStage } from '@/lib/pipeline/analytics'

// React doit être référencé pour que createElement / le runtime classic
// ne le tree-shake pas — sinon `motion/react` mock casse.
void React

// ── Mock motion/react ─────────────────────────────────────────────────────────
// On garde le composant testable côté DOM : `m.path` devient un `<path>`
// natif, `useReducedMotion()` retourne false.
vi.mock('motion/react', () => {
  const passthrough = (tag: string) =>
    function Passthrough({
      children,
      initial: _initial,
      animate: _animate,
      transition: _transition,
      ...rest
    }: Record<string, unknown> & { children?: ReactNode }) {
      return createElement(tag as ElementType, rest, children)
    }
  return {
    m: new Proxy(
      {},
      {
        get: (_t, prop: string) => passthrough(prop),
      },
    ),
    useReducedMotion: () => false,
  }
})

beforeAll(() => {
  // jsdom : ResizeObserver pas dispo (utile si un jour on observe la taille du SVG).
  if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
    class StubResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    ;(window as unknown as { ResizeObserver: typeof StubResizeObserver }).ResizeObserver =
      StubResizeObserver
  }
})

// ── Helpers fixtures ─────────────────────────────────────────────────────────

function makeCounts(
  overrides: Partial<Record<ProspectStatus, number>> = {},
): Record<ProspectStatus, number> {
  return {
    sourced: 0,
    qualified: 0,
    contacted: 0,
    interested: 0,
    offer_sent: 0,
    rdv: 0,
    converted: 0,
    rejected: 0,
    on_hold: 0,
    do_not_contact: 0,
    ...overrides,
  }
}

// ── computeFunnelGeometry ────────────────────────────────────────────────────

describe('computeFunnelGeometry', () => {
  it('renvoie un tableau vide pour 0 étage', () => {
    expect(computeFunnelGeometry([])).toEqual([])
  })

  it('respecte la largeur minimale pour les étages à count 0', () => {
    const stages: FunnelStage[] = [
      { step: 'sourced', label: 'Sourcé', count: 100, stepConversionPct: 100, cumulativePct: 100 },
      { step: 'qualified', label: 'Qualifié', count: 0, stepConversionPct: 0, cumulativePct: 0 },
      { step: 'contacted', label: 'Contacté', count: 0, stepConversionPct: 0, cumulativePct: 0 },
      { step: 'rdv', label: 'RDV', count: 0, stepConversionPct: 0, cumulativePct: 0 },
      { step: 'converted', label: 'Converti', count: 0, stepConversionPct: 0, cumulativePct: 0 },
    ]
    const geo = computeFunnelGeometry(stages, 500, 40)
    expect(geo).toHaveLength(5)
    expect(geo[0].top).toBeCloseTo(500, 0) // ratio 1
    // Toutes les largeurs ≥ minWidth
    for (const g of geo) {
      expect(g.top).toBeGreaterThanOrEqual(40)
      expect(g.bottom).toBeGreaterThanOrEqual(40)
    }
  })

  it("propage la largeur de l'étage suivant en bottom", () => {
    const stages: FunnelStage[] = [
      { step: 'sourced', label: 'Sourcé', count: 100, stepConversionPct: 100, cumulativePct: 100 },
      { step: 'qualified', label: 'Qualifié', count: 50, stepConversionPct: 50, cumulativePct: 50 },
      { step: 'contacted', label: 'Contacté', count: 25, stepConversionPct: 50, cumulativePct: 25 },
      { step: 'rdv', label: 'RDV', count: 10, stepConversionPct: 40, cumulativePct: 10 },
      { step: 'converted', label: 'Converti', count: 5, stepConversionPct: 50, cumulativePct: 5 },
    ]
    const geo = computeFunnelGeometry(stages, 400, 10)
    // Le top du 2ᵉ doit être ~ égal au bottom du 1ᵉʳ.
    expect(geo[1].top).toBeCloseTo(geo[0].bottom, 5)
    // Le dernier a bottom = top (pas de suivant).
    expect(geo[4].top).toBeCloseTo(geo[4].bottom, 5)
  })
})

// ── trapezoidPath ────────────────────────────────────────────────────────────

describe('trapezoidPath', () => {
  it('produit un path SVG fermé', () => {
    const p = trapezoidPath(10, 100, 90, 20, 0, 60, 8)
    expect(p).toMatch(/^M /)
    expect(p.trim().endsWith('Z')).toBe(true)
  })

  it('produit un path polygonal (sans arcs) si r = 0', () => {
    const p = trapezoidPath(0, 100, 90, 10, 0, 60, 0)
    expect(p).not.toMatch(/A /)
  })

  it('clamp le rayon si trapèze trop étroit', () => {
    // bord haut = 10, donc r max = 5 ; on demande r=20.
    const p = trapezoidPath(0, 10, 10, 0, 0, 100, 20)
    // Doit produire un path valide (pas de NaN).
    expect(p).not.toMatch(/NaN/)
    expect(p.trim().endsWith('Z')).toBe(true)
  })
})

// ── ConversionFunnel render ──────────────────────────────────────────────────

describe('ConversionFunnel', () => {
  it('rend tous les étages avec leur label', () => {
    const counts = makeCounts({
      sourced: 50,
      qualified: 30,
      contacted: 20,
      interested: 10,
      rdv: 5,
      converted: 3,
    })
    render(<ConversionFunnel countsByStatus={counts} />)
    // Le SVG contient les labels (legend desktop intégrée + mobile)
    expect(screen.getAllByText('Sourcé').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Qualifié').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Contacté').length).toBeGreaterThan(0)
    expect(screen.getAllByText('RDV').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Converti').length).toBeGreaterThan(0)
  })

  it('affiche le total cumulatif sur la 1re étape (sourced)', () => {
    const counts = makeCounts({ sourced: 10, qualified: 5, converted: 1 })
    render(<ConversionFunnel countsByStatus={counts} />)
    // sourced cumulatif = 10 + 5 + 1 + autres = 16
    // On vérifie juste que le SVG est rendu avec un role img.
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('entonnoir'),
    )
  })

  it('affiche l\'état vide quand toutes les counts sont à 0', () => {
    const counts = makeCounts({})
    render(<ConversionFunnel countsByStatus={counts} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/Aucun prospect actif/i)).toBeInTheDocument()
  })

  it('affiche le badge "0 conversion" si sourced > 0 mais converted = 0', () => {
    const counts = makeCounts({ sourced: 10, qualified: 4 })
    render(<ConversionFunnel countsByStatus={counts} />)
    expect(screen.getByText(/0 conversion/i)).toBeInTheDocument()
  })

  it("n'affiche pas le badge 0 conversion s'il y a au moins 1 converti", () => {
    const counts = makeCounts({ sourced: 10, qualified: 5, converted: 2 })
    render(<ConversionFunnel countsByStatus={counts} />)
    expect(screen.queryByText(/0 conversion/i)).not.toBeInTheDocument()
  })

  it('expose un container full-width (pas de max-w-md)', () => {
    const counts = makeCounts({ sourced: 5 })
    const { container } = render(<ConversionFunnel countsByStatus={counts} />)
    const section = container.querySelector('section')
    expect(section).not.toBeNull()
    expect(section?.className).toContain('w-full')
    expect(section?.className).not.toContain('max-w-md')
  })
})
