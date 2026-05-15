import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock next/image → simple <img> (jsdom-friendly, pas d'optimization).
// On strip les props non-DOM (priority, onError, etc.) avant forward.
vi.mock('next/image', () => ({
  default: ({
    src,
    alt,
    width,
    height,
    className,
    style,
  }: {
    src: string
    alt: string
    width?: number
    height?: number
    className?: string
    style?: React.CSSProperties
  }) => {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={className}
        style={style}
        data-testid="glan-portrait-img"
      />
    )
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

  // ── Animations avancées (LOT post-pivot 2026-05-15) ─────────────────── //

  it('affiche le clignement (eyelid overlay) sauf en error', () => {
    const { rerender } = render(<GlanPortrait state="dormant" />)
    expect(screen.queryByTestId('glan-portrait-eyelid')).toBeInTheDocument()

    rerender(<GlanPortrait state="working" />)
    expect(screen.queryByTestId('glan-portrait-eyelid')).toBeInTheDocument()

    rerender(<GlanPortrait state="done" />)
    expect(screen.queryByTestId('glan-portrait-eyelid')).toBeInTheDocument()

    rerender(<GlanPortrait state="error" />)
    // En error, sourcils froncés → pas de clignement.
    expect(screen.queryByTestId('glan-portrait-eyelid')).not.toBeInTheDocument()
  })

  it('affiche les speech-dots uniquement en working', () => {
    const { rerender } = render(<GlanPortrait state="dormant" />)
    expect(screen.queryByTestId('glan-portrait-speech-dots')).not.toBeInTheDocument()

    rerender(<GlanPortrait state="working" />)
    expect(screen.queryByTestId('glan-portrait-speech-dots')).toBeInTheDocument()

    rerender(<GlanPortrait state="done" />)
    expect(screen.queryByTestId('glan-portrait-speech-dots')).not.toBeInTheDocument()

    rerender(<GlanPortrait state="error" />)
    expect(screen.queryByTestId('glan-portrait-speech-dots')).not.toBeInTheDocument()
  })

  it('déclenche un sparkles burst à l\'entrée dans `done`', () => {
    const { rerender } = render(<GlanPortrait state="working" />)
    expect(screen.queryByTestId('glan-portrait-sparkles')).not.toBeInTheDocument()

    // Transition working → done déclenche le burst transitoire.
    rerender(<GlanPortrait state="done" />)
    expect(screen.queryByTestId('glan-portrait-sparkles')).toBeInTheDocument()
  })
})
