import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// next/dynamic en environnement Vitest : on retourne un composant qui rend null
// (le 3D ne sera pas chargé) — le loader doit basculer sur le fallback SVG.
vi.mock('next/dynamic', () => ({
  default: () => () => null,
}))

import { GlanCharacterLoader } from './glan-character-loader'

describe('GlanCharacterLoader', () => {
  it('rend GlanAvatar SVG en fallback par défaut (capabilities indisponibles en jsdom)', () => {
    render(<GlanCharacterLoader state="working" />)
    // GlanAvatar SVG expose role="img" + aria-label localisé.
    expect(screen.getByRole('img', { name: /glan travaille/i })).toBeInTheDocument()
  })

  it('respecte forceFallback même quand decided=true', () => {
    render(<GlanCharacterLoader state="done" forceFallback />)
    expect(screen.getByRole('img', { name: /a terminé/i })).toBeInTheDocument()
  })

  it('supporte les 4 états en fallback', () => {
    const states = ['dormant', 'working', 'done', 'error'] as const
    for (const s of states) {
      const { unmount } = render(<GlanCharacterLoader state={s} forceFallback />)
      expect(screen.getByRole('img')).toBeInTheDocument()
      unmount()
    }
  })

  it('applique la taille du wrapper fallback', () => {
    const { container } = render(<GlanCharacterLoader state="dormant" size={200} forceFallback />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.style.width).toBe('200px')
    expect(wrapper.style.height).toBe('200px')
  })
})
