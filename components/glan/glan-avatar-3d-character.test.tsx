import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

// Mock R3F + drei AVANT l'import du composant (R3F = WebGL, indisponible en jsdom).
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <div data-testid="r3f-canvas">{children}</div>,
  useFrame: () => undefined,
}))

vi.mock('@react-three/drei', () => ({
  Float: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

// Import après le mock.
import { GlanAvatar3DCharacter } from './glan-avatar-3d-character'

describe('GlanAvatar3DCharacter', () => {
  it('rend un libellé accessible par défaut selon l\'état', () => {
    render(<GlanAvatar3DCharacter state="working" />)
    expect(screen.getByRole('img', { name: /glan travaille/i })).toBeInTheDocument()
  })

  it('supporte les 4 états sémantiques', () => {
    const states = ['dormant', 'working', 'done', 'error'] as const
    for (const s of states) {
      const { unmount } = render(<GlanAvatar3DCharacter state={s} />)
      expect(screen.getByRole('img')).toBeInTheDocument()
      unmount()
    }
  })

  it('applique la taille passée en prop', () => {
    const { container } = render(<GlanAvatar3DCharacter state="dormant" size={180} />)
    const wrapper = container.querySelector('[role="img"]') as HTMLElement
    expect(wrapper.style.width).toBe('180px')
    expect(wrapper.style.height).toBe('180px')
  })

  it('supporte plusieurs tailles', () => {
    const sizes = [180, 200, 320, 400]
    for (const s of sizes) {
      const { container, unmount } = render(<GlanAvatar3DCharacter state="working" size={s} />)
      const wrapper = container.querySelector('[role="img"]') as HTMLElement
      expect(wrapper.style.width).toBe(`${s}px`)
      unmount()
    }
  })

  it('rend un canvas R3F (mocké) à l\'intérieur', () => {
    render(<GlanAvatar3DCharacter state="done" />)
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument()
  })

  it('utilise un label spécifique par état', () => {
    const labels: Record<string, RegExp> = {
      dormant: /au repos/i,
      working: /travaille/i,
      done: /a terminé/i,
      error: /erreur/i,
    }
    for (const [state, regex] of Object.entries(labels)) {
      const { unmount } = render(
        <GlanAvatar3DCharacter state={state as 'dormant' | 'working' | 'done' | 'error'} />,
      )
      expect(screen.getByRole('img', { name: regex })).toBeInTheDocument()
      unmount()
    }
  })
})
