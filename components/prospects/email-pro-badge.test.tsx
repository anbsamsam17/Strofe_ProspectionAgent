// ============================================================
// Tests : EmailProBadge
// ------------------------------------------------------------
// Couvre les 4 cas visuels :
//   - isPro=true,  verified=true  → "✓ Email pro vérifié" (vert)
//   - isPro=true,  verified=false → "Email pro non vérifié" (cyan)
//   - isPro=false                  → "Email perso non envoyable" (gray italic)
//   - isPro=null                   → composant ne rend rien
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import { EmailProBadge } from './email-pro-badge'

afterEach(() => cleanup())

describe('EmailProBadge — pro + vérifié', () => {
  it('affiche "✓ Email pro vérifié" avec accent vert', () => {
    render(<EmailProBadge isPro={true} verified={true} />)
    const badge = screen.getByText(/Email pro vérifié/i)
    expect(badge).toBeInTheDocument()
    expect(badge.textContent).toContain('✓')
    expect(badge.className).toContain('green')
    expect(badge.getAttribute('aria-label')).toMatch(/vérifié/i)
  })
})

describe('EmailProBadge — pro non vérifié', () => {
  it('affiche "Email pro non vérifié" avec accent cyan', () => {
    render(<EmailProBadge isPro={true} verified={false} />)
    const badge = screen.getByText(/Email pro non vérifié/i)
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('cyan')
    expect(badge.className).not.toContain('italic')
  })

  it('verified omis → traité comme non vérifié', () => {
    render(<EmailProBadge isPro={true} />)
    expect(screen.getByText(/Email pro non vérifié/i)).toBeInTheDocument()
  })
})

describe('EmailProBadge — perso', () => {
  it('affiche "Email perso non envoyable" en gris italique', () => {
    render(<EmailProBadge isPro={false} />)
    const badge = screen.getByText(/Email perso non envoyable/i)
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('italic')
    expect(badge.className).toContain('gray')
  })
})

describe('EmailProBadge — null / undefined', () => {
  it('ne rend rien quand isPro=null', () => {
    const { container } = render(<EmailProBadge isPro={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('ne rend rien quand isPro=undefined', () => {
    const { container } = render(<EmailProBadge isPro={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})
