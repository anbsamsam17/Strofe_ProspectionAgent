import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock next/image → simple <img> (jsdom-friendly, pas d'optimization).
vi.mock('next/image', () => ({
  default: ({ src, alt, ...rest }: { src: string; alt: string; [k: string]: unknown }) => {
    // Rend un <img> normal pour le test (drop refs/handlers non-DOM).
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} data-testid="glan-portrait-img" {...rest} />
  },
}))

import { GlanPortrait } from './glan-portrait'

describe('GlanPortrait', () => {
  it('rend le portrait avec aria-label par défaut (dormant)', () => {
    render(<GlanPortrait />)
    expect(screen.getByRole('img', { name: /glan au repos/i })).toBeInTheDocument()
  })

  it('supporte les 4 états avec labels distincts', () => {
    const cases = [
      { state: 'dormant' as const, label: /glan au repos/i },
      { state: 'working' as const, label: /glan travaille/i },
      { state: 'done' as const, label: /a terminé/i },
      { state: 'error' as const, label: /erreur/i },
    ]
    for (const { state, label } of cases) {
      const { unmount } = render(<GlanPortrait state={state} />)
      expect(screen.getByRole('img', { name: label })).toBeInTheDocument()
      unmount()
    }
  })

  it('applique la taille au wrapper', () => {
    const { container } = render(<GlanPortrait size={256} />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.style.width).toBe('256px')
    expect(wrapper.style.height).toBe('256px')
  })

  it('pointe vers le bon fichier PNG selon état', () => {
    const { rerender } = render(<GlanPortrait state="working" />)
    expect(screen.getByTestId('glan-portrait-img').getAttribute('src')).toContain(
      'portrait-working.png',
    )
    rerender(<GlanPortrait state="done" />)
    expect(screen.getByTestId('glan-portrait-img').getAttribute('src')).toContain(
      'portrait-done.png',
    )
    rerender(<GlanPortrait state="dormant" />)
    expect(screen.getByTestId('glan-portrait-img').getAttribute('src')).toContain(
      'portrait.png',
    )
  })

  it('expose une pastille état (decoration)', () => {
    const { container } = render(<GlanPortrait state="working" />)
    // 1 wrapper role=img + image décorative + pastille bottom-right
    // On vérifie que le wrapper contient bien un <img> + des spans aria-hidden
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(2)
  })
})
