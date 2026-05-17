// ============================================================
// Tests : NotificationBell
// ------------------------------------------------------------
// Couvre :
//   - Badge "3" visible quand 3 relances dues.
//   - Pas de badge visible quand 0 relances.
//   - Lien pointe vers /notifications.
//   - aria-label accessible et contextuel.
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// NotificationBell est un Server Component asynchrone. On le teste via un
// wrapper synchrone qui simule le retour du fetch Supabase.
// On mock createClient et auth.getUser au niveau module.

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

// next/link est rendu comme un <a> en environnement jsdom.
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import { createClient } from '@/lib/supabase/server'
import { NotificationBell } from './notification-bell'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Construit un mock Supabase minimaliste pour NotificationBell.
 * `count` est la valeur renvoyée par le .select('id', { count: 'exact', head: true }).
 */
function mockSupabase(pendingCount: number) {
  const selectMock = vi.fn().mockResolvedValue({ count: pendingCount, error: null })
  const headMock = vi.fn(() => ({ count: pendingCount, error: null })) // unused but typed
  const chainable = {
    not: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnValue({
      not: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lte: selectMock,
    }),
    from: vi.fn().mockReturnThis(),
  }

  // Supabase client minimal : from().select().not().eq().lte() → { count, error }
  const supabaseMock = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'uid-test' } },
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        not: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        lte: vi.fn().mockResolvedValue({ count: pendingCount, error: null }),
      }),
    }),
  }
  return supabaseMock
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotificationBell — avec relances dues', () => {
  it('affiche un badge avec le bon compteur quand 3 relances dues', async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase(3) as unknown as Awaited<ReturnType<typeof createClient>>)

    const jsx = await NotificationBell()
    render(jsx)

    // Badge visible avec "3"
    const badge = screen.getByText('3')
    expect(badge).toBeInTheDocument()
    // aria-hidden sur le badge (décoratif — le label est sur le lien)
    expect(badge).toHaveAttribute('aria-hidden', 'true')
  })

  it("affiche 99+ si le compteur dépasse 99", async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase(120) as unknown as Awaited<ReturnType<typeof createClient>>)

    const jsx = await NotificationBell()
    render(jsx)

    expect(screen.getByText('99+')).toBeInTheDocument()
  })

  it("l'aria-label mentionne le nombre de relances", async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase(3) as unknown as Awaited<ReturnType<typeof createClient>>)

    const jsx = await NotificationBell()
    render(jsx)

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('aria-label', expect.stringContaining('3'))
    expect(link).toHaveAttribute('aria-label', expect.stringContaining('relance'))
  })
})

describe('NotificationBell — sans relances dues', () => {
  it("n'affiche pas de badge quand 0 relances", async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase(0) as unknown as Awaited<ReturnType<typeof createClient>>)

    const jsx = await NotificationBell()
    render(jsx)

    // Pas de pastille — le compteur "0" ne doit pas être dans le DOM.
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it("pointe vers /notifications", async () => {
    vi.mocked(createClient).mockResolvedValue(mockSupabase(0) as unknown as Awaited<ReturnType<typeof createClient>>)

    const jsx = await NotificationBell()
    render(jsx)

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/notifications')
  })
})
