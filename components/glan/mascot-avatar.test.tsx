import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock @rive-app/react-canvas BEFORE importing the component
vi.mock('@rive-app/react-canvas', () => ({
  useRive: () => ({
    rive: null,
    RiveComponent: () => null,
  }),
  useStateMachineInput: () => null,
  Layout: class {
    constructor() {}
  },
  Fit: { Contain: 'contain' },
  Alignment: { Center: 'center' },
}))

// Import après le mock
import { MascotAvatar } from './mascot-avatar'

describe('MascotAvatar', () => {
  it("retombe sur GlanAvatar CSS quand l'asset Rive n'est pas chargé", () => {
    render(<MascotAvatar state="working" />)
    // GlanAvatar CSS expose un role="img" avec aria-label
    expect(screen.getByRole('img', { name: /glan travaille/i })).toBeInTheDocument()
  })

  it('respecte le prop forceFallback (utile en test/SSR)', () => {
    render(<MascotAvatar state="done" forceFallback />)
    expect(screen.getByRole('img', { name: /glan a terminé/i })).toBeInTheDocument()
  })

  it('supporte les 4 états sémantiques', () => {
    const states = ['dormant', 'working', 'done', 'error'] as const
    for (const s of states) {
      const { unmount } = render(<MascotAvatar state={s} forceFallback />)
      expect(screen.getByRole('img')).toBeInTheDocument()
      unmount()
    }
  })

  it('supporte les 3 tailles', () => {
    const { rerender } = render(<MascotAvatar size="sm" forceFallback />)
    expect(screen.getByRole('img')).toBeInTheDocument()
    rerender(<MascotAvatar size="md" forceFallback />)
    expect(screen.getByRole('img')).toBeInTheDocument()
    rerender(<MascotAvatar size="lg" forceFallback />)
    expect(screen.getByRole('img')).toBeInTheDocument()
  })
})
