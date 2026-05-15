import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { GlanAvatar } from './glan-avatar'

describe('GlanAvatar', () => {
  it('rend un libellé accessible par défaut selon l\'état', () => {
    render(<GlanAvatar state="working" />)
    expect(screen.getByRole('img', { name: /glan travaille/i })).toBeInTheDocument()
  })

  it('permet de surcharger le label accessible', () => {
    render(<GlanAvatar state="done" label="Liste prête pour Marie" />)
    expect(
      screen.getByRole('img', { name: /liste prête pour marie/i }),
    ).toBeInTheDocument()
  })

  it('utilise les 3 tailles', () => {
    const { rerender } = render(<GlanAvatar size="sm" />)
    expect(screen.getByRole('img')).toBeInTheDocument()

    rerender(<GlanAvatar size="md" />)
    expect(screen.getByRole('img')).toBeInTheDocument()

    rerender(<GlanAvatar size="lg" />)
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('a un libellé spécifique pour chaque état', () => {
    const labels: Record<string, RegExp> = {
      dormant: /au repos/i,
      working: /travaille/i,
      done: /a terminé/i,
      error: /erreur/i,
    }

    for (const [state, regex] of Object.entries(labels)) {
      const { unmount } = render(
        <GlanAvatar state={state as 'dormant' | 'working' | 'done' | 'error'} />,
      )
      expect(screen.getByRole('img', { name: regex })).toBeInTheDocument()
      unmount()
    }
  })
})
