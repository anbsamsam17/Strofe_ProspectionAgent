// ============================================================
// Tests : SireneCacheStatus
// ------------------------------------------------------------
// Couvre :
//   - Rendu nominal "fresh" (badge vert, métriques affichées).
//   - Cas `is_empty: true` → bouton "Lancer l'import initial" + alerte.
//   - Cas erreur fetch → bloc d'erreur + bouton "Réessayer".
//   - Click "Re-importer" → dialog ouvert avec champ "GO" et commande copiable.
//   - ESC ferme le dialog.
//
// Stratégie :
//   - Mock global `fetch` par test.
//   - Pas de polling réel (on n'attend pas 30s — on vérifie juste le 1er fetch).
//   - Mock `navigator.clipboard.writeText` pour le bouton "Copier".
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

import { SireneCacheStatus } from './sirene-cache-status'

// ── Fixtures ──────────────────────────────────────────────────────────────

function freshStatus() {
  return {
    data: {
      active_count: 87_432,
      total_size: '78 MB',
      total_bytes: 81_788_928, // ~78 MB
      days_since_import: 3,
      last_import_at: '2026-05-14T03:00:00.000Z',
      freshness: 'fresh' as const,
      is_empty: false,
    },
  }
}

function emptyStatus() {
  return {
    data: {
      active_count: 0,
      total_size: '0 MB',
      total_bytes: 0,
      days_since_import: null,
      last_import_at: null,
      freshness: 'empty' as const,
      is_empty: true,
    },
  }
}

function mockFetchOk(payload: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(payload),
  })
}

function mockFetchError() {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: { code: 'DB_ERROR', message: 'Boom' } }),
  })
}

// ── Setup / teardown ──────────────────────────────────────────────────────

beforeEach(() => {
  // navigator.clipboard n'est pas fourni par jsdom — on mock.
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  cleanup()
})

// ── Tests ─────────────────────────────────────────────────────────────────

describe('SireneCacheStatus — rendu nominal', () => {
  it('affiche les métriques et un badge "Frais" quand l\'API renvoie freshness=fresh', async () => {
    vi.stubGlobal('fetch', mockFetchOk(freshStatus()))

    render(<SireneCacheStatus />)

    // Attente du fetch initial.
    await waitFor(() => {
      expect(screen.getByText('Frais')).toBeInTheDocument()
    })

    // Métriques visibles.
    // (en-FR utilise NBSP/narrow-NBSP comme séparateur — on cherche par regex).
    expect(screen.getByText(/87\s?432/)).toBeInTheDocument()
    expect(screen.getByText(/78 MB \/ 100 MB max/)).toBeInTheDocument()

    // Date formatée fr-FR avec delta jours.
    expect(screen.getByText(/mai 2026 \(3 jours\)/i)).toBeInTheDocument()

    // CTA "Re-importer maintenant" (cache non vide).
    expect(screen.getByRole('button', { name: /Re-importer maintenant/i })).toBeInTheDocument()
  })

  it("affiche un bouton 'Lancer l'import initial' quand le cache est vide", async () => {
    vi.stubGlobal('fetch', mockFetchOk(emptyStatus()))

    render(<SireneCacheStatus />)

    await waitFor(() => {
      expect(screen.getByText('Vide')).toBeInTheDocument()
    })

    // Alerte "Cache vide".
    expect(screen.getByText(/Cache vide, lancer l'import initial\./i)).toBeInTheDocument()

    // CTA basculé sur "Lancer l'import initial".
    expect(screen.getByRole('button', { name: /Lancer l'import initial/i })).toBeInTheDocument()
  })
})

describe('SireneCacheStatus — gestion d\'erreur', () => {
  it("affiche un bloc d'erreur quand le fetch échoue", async () => {
    vi.stubGlobal('fetch', mockFetchError())

    render(<SireneCacheStatus />)

    await waitFor(() => {
      expect(
        screen.getByText(/Impossible de récupérer le statut du cache/i),
      ).toBeInTheDocument()
    })

    // Message d'erreur backend remonté.
    expect(screen.getByText(/Boom/i)).toBeInTheDocument()

    // Bouton Réessayer disponible.
    expect(screen.getByRole('button', { name: /Réessayer/i })).toBeInTheDocument()
  })

  it("affiche un message générique quand fetch rejette (réseau)", async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('NetworkDown')))

    render(<SireneCacheStatus />)

    await waitFor(() => {
      expect(screen.getByText(/NetworkDown/i)).toBeInTheDocument()
    })
  })
})

describe('SireneCacheStatus — dialog de re-import', () => {
  it("ouvre un dialog avec champ 'GO' au clic sur 'Re-importer maintenant'", async () => {
    vi.stubGlobal('fetch', mockFetchOk(freshStatus()))

    render(<SireneCacheStatus />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Re-importer maintenant/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Re-importer maintenant/i }))

    // Dialog présent avec aria-modal.
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    // Commande à copier-coller visible.
    expect(
      screen.getByText('gh workflow run sirene-import.yml -f force=true'),
    ).toBeInTheDocument()

    // Champ texte "GO" présent.
    const confirmInput = screen.getByLabelText(/Tapez « GO » pour confirmer/i)
    expect(confirmInput).toBeInTheDocument()

    // Bouton de confirmation désactivé tant que "GO" non tapé.
    const confirmBtn = screen.getByRole('button', { name: /J'ai exécuté la commande/i })
    expect(confirmBtn).toBeDisabled()

    // Tape "GO" → bouton actif.
    fireEvent.change(confirmInput, { target: { value: 'GO' } })
    expect(confirmBtn).not.toBeDisabled()
  })

  it('ferme le dialog quand on appuie sur Échap', async () => {
    vi.stubGlobal('fetch', mockFetchOk(freshStatus()))

    render(<SireneCacheStatus />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Re-importer maintenant/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Re-importer maintenant/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
