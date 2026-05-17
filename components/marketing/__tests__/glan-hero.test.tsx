// ============================================================
// glan-hero.test.tsx — tests unitaires de GlanHero + GlanHeroFallback
//
// Couvre :
//   - H1 avec les textes finaux post-pivot ("Vos prospects bilan carbone,"
//     + "qualifiés à la demande.") — source : docs/copy/glan-copy-refonte.md A.2
//   - Badge "Agent de sourcing — Prospection BEGES"
//   - CTA primary "Lancer Glan" → lien /signup
//   - CTA secondary "Se connecter" → lien /login
//   - Signature "— Glan, votre agent de sourcing BEGES"
//   - GlanHeroFallback : mêmes textes clés, sans dépendances Client
//   - Guards anti-régression sur les formulations bannies (pré-pivot)
//
// Mocks :
//   - motion/react → composants inertes forward-children (jsdom sans animations)
//   - @/components/glan/glan-portrait → stub testid
//   - @/components/ui/border-beam → wrapper transparent
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

// ── Mock motion/react ─────────────────────────────────────────────────── //
// On remplace chaque composant motion par un élément HTML passif.
// Les props motion (initial, animate, variants, whileHover…) sont ignorées ;
// style et className sont conservées pour ne pas casser la structure DOM.

type MotionProps = {
  children?: React.ReactNode
  style?: React.CSSProperties
  className?: string
  [key: string]: unknown
}

function makeMotionEl(tag: string) {
  function MotionEl({ children, style, className }: MotionProps) {
    return React.createElement(tag, { style, className }, children)
  }
  MotionEl.displayName = `Motion_${tag}`
  return MotionEl
}

vi.mock('motion/react', () => {
  const m = new Proxy({} as Record<string, ReturnType<typeof makeMotionEl>>, {
    get: (_target, prop: string) => makeMotionEl(prop),
  })

  return {
    m,
    useReducedMotion: () => true,
    useScroll: () => ({ scrollYProgress: { get: () => 0 } }),
    useTransform: () => 0,
    useMotionValue: () => ({ set: vi.fn(), get: () => 0 }),
    useSpring: () => ({ set: vi.fn(), get: () => 0 }),
  }
})

// ── Mock GlanPortrait ──────────────────────────────────────────────────── //

vi.mock('@/components/glan/glan-portrait', () => ({
  GlanPortrait: () => React.createElement('div', { 'data-testid': 'glan-portrait' }),
}))

// ── Mock BorderBeam ────────────────────────────────────────────────────── //

vi.mock('@/components/ui/border-beam', () => ({
  BorderBeam: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}))

// ── Import après les mocks ─────────────────────────────────────────────── //

import { GlanHero, GlanHeroFallback } from '../glan-hero'

// ── Tests ─────────────────────────────────────────────────────────────── //

describe('GlanHero', () => {
  describe('H1 — textes post-pivot', () => {
    it('contient les mots-clés de la ligne 1 du H1 : "prospects bilan carbone"', () => {
      render(<GlanHero />)
      const h1 = screen.getByRole('heading', { level: 1 })
      // Le composant anime chaque mot dans un m.span séparé ; le mock supprime
      // les espaces typographiques inter-spans. On teste les mots individuels.
      expect(h1.textContent).toContain('prospects')
      expect(h1.textContent).toContain('bilan')
      expect(h1.textContent).toContain('carbone,')
    })

    it('contient les mots-clés de la ligne 2 du H1 : "qualifiés à la demande"', () => {
      render(<GlanHero />)
      const h1 = screen.getByRole('heading', { level: 1 })
      expect(h1.textContent).toContain('qualifiés')
      expect(h1.textContent).toContain('demande.')
    })

    it('ne contient PAS la formulation bannie "pendant la nuit"', () => {
      render(<GlanHero />)
      const h1 = screen.getByRole('heading', { level: 1 })
      expect(h1.textContent).not.toMatch(/pendant la nuit/i)
    })

    it('ne contient PAS "qualifiés pendant" (ancienne ligne 2 pré-pivot)', () => {
      render(<GlanHero />)
      const h1 = screen.getByRole('heading', { level: 1 })
      // Détecte la séquence "qualifiés" suivi de "pendant" quelle que soit la casse
      expect(h1.textContent).not.toMatch(/qualifi[eé]s\s*pendant/i)
    })
  })

  describe('Badge', () => {
    it('affiche le badge "Agent de sourcing — Prospection BEGES"', () => {
      render(<GlanHero />)
      expect(screen.getByText('Agent de sourcing — Prospection BEGES')).toBeInTheDocument()
    })
  })

  describe('CTAs', () => {
    it('CTA primary "Lancer Glan" est un lien vers /signup', () => {
      render(<GlanHero />)
      const cta = screen.getByRole('link', { name: /Lancer Glan/i })
      expect(cta).toBeInTheDocument()
      expect(cta).toHaveAttribute('href', '/signup')
    })

    it('CTA secondary "Se connecter" est un lien vers /login', () => {
      render(<GlanHero />)
      const login = screen.getByRole('link', { name: /Se connecter/i })
      expect(login).toBeInTheDocument()
      expect(login).toHaveAttribute('href', '/login')
    })

    it("ne contient PAS le CTA banni \"Activer l'agent\"", () => {
      render(<GlanHero />)
      expect(screen.queryByRole('link', { name: /Activer l'agent/i })).toBeNull()
    })
  })

  describe('Signature', () => {
    it('affiche la signature "— Glan, votre agent de sourcing BEGES"', () => {
      render(<GlanHero />)
      expect(
        screen.getByText('— Glan, votre agent de sourcing BEGES'),
      ).toBeInTheDocument()
    })
  })
})

describe('GlanHeroFallback', () => {
  it('contient "Vos prospects bilan carbone," dans le H1', () => {
    render(<GlanHeroFallback />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toContain('Vos prospects bilan carbone,')
  })

  it('contient "qualifiés à la demande." dans le H1', () => {
    render(<GlanHeroFallback />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toContain('qualifiés à la demande.')
  })

  it('affiche le badge "Agent de sourcing — Prospection BEGES"', () => {
    render(<GlanHeroFallback />)
    expect(screen.getByText('Agent de sourcing — Prospection BEGES')).toBeInTheDocument()
  })
})
