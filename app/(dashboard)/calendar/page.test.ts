// ============================================================
// TESTS — app/(dashboard)/calendar/page.tsx
//
// Server Component qui fetch les rappels (prospect_exchanges) avec
// callback_date IS NOT NULL et callback_done = false, joint le prospect,
// et passe au composant client CalendarView.
//
// On teste :
//   - Auth manquant → redirect('/login').
//   - Fetch nominal → events bien mappes vers ExchangeEvent (CC props).
//   - Fallback migration 014 manquante (callback_done) → 2eme query
//     sans le filtre callback_done.
//   - Robustesse : prospect null ou callback_date null filtres out.
//
// On mock CalendarView pour capturer ses props sans monter FullCalendar
// (qui plante en jsdom sans `window.IntersectionObserver` etc.). On rend
// le node JSX retourne par le page Server Component avec
// @testing-library/react (l'appel direct CalendarPage() renvoie un node
// non-monte, le mock CalendarView ne serait pas invoque sans render).
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn()
const mockRedirect = vi.fn((_url: string) => {
  throw new Error('REDIRECT')
})

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}))

// On capture les props passees a CalendarView via une variable de module.
const capturedProps: { events?: unknown } = {}

vi.mock('@/components/calendar/calendar-view', () => ({
  CalendarView: (props: { events: unknown }) => {
    capturedProps.events = props.events
    return null
  },
}))

// Mock Supabase server client — par defaut renvoie un utilisateur authentifie
// et un from() chainable qu'on reconfigure par test.
const fromMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: fromMock,
  })),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFromChain(result: {
  data: unknown[] | null
  error: { code?: string; message?: string } | null
}) {
  return {
    select: vi.fn(() => ({
      not: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn().mockResolvedValue(result),
        })),
        order: vi.fn().mockResolvedValue(result),
      })),
    })),
  }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetUser.mockReset()
  mockRedirect.mockReset()
  mockRedirect.mockImplementation((_url: string) => {
    throw new Error('REDIRECT')
  })
  fromMock.mockReset()
  capturedProps.events = undefined
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /calendar (Server Component)', () => {
  it('redirect /login si pas authentifie', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const { default: CalendarPage } = await import('./page')
    await expect(CalendarPage()).rejects.toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/login')
  })

  it('mappe les rappels vers ExchangeEvent (prospect en objet)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })

    fromMock.mockReturnValue(
      buildFromChain({
        data: [
          {
            id: 'ex-1',
            prospect_id: 'p-1',
            occurred_at: '2026-05-01T10:00:00Z',
            type: 'appel',
            notes: 'Note 1',
            callback_date: '2026-06-01T09:00:00Z',
            callback_done: false,
            prospect: {
              id: 'p-1',
              raison_sociale: 'Acme SAS',
              siren: '123456789',
            },
          },
        ],
        error: null,
      }),
    )

    const { default: CalendarPage } = await import('./page')
    const node = (await CalendarPage()) as ReactElement
    render(node)

    expect(capturedProps.events).toEqual([
      {
        id: 'ex-1',
        prospect_id: 'p-1',
        prospect_raison_sociale: 'Acme SAS',
        prospect_siren: '123456789',
        type: 'appel',
        callback_date: '2026-06-01T09:00:00Z',
        notes: 'Note 1',
      },
    ])
  })

  it('accepte un prospect renvoye en tableau par l’embedding Supabase', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })

    fromMock.mockReturnValue(
      buildFromChain({
        data: [
          {
            id: 'ex-2',
            prospect_id: 'p-2',
            occurred_at: '2026-05-02T10:00:00Z',
            type: 'email',
            notes: null,
            callback_date: '2026-06-02T09:00:00Z',
            callback_done: false,
            prospect: [
              { id: 'p-2', raison_sociale: 'Beta SARL', siren: null },
            ],
          },
        ],
        error: null,
      }),
    )

    const { default: CalendarPage } = await import('./page')
    const node = (await CalendarPage()) as ReactElement
    render(node)

    expect(capturedProps.events).toEqual([
      {
        id: 'ex-2',
        prospect_id: 'p-2',
        prospect_raison_sociale: 'Beta SARL',
        prospect_siren: null,
        type: 'email',
        callback_date: '2026-06-02T09:00:00Z',
        notes: null,
      },
    ])
  })

  it('filtre les rows sans prospect ou sans callback_date', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })

    fromMock.mockReturnValue(
      buildFromChain({
        data: [
          // Row valide
          {
            id: 'ex-ok',
            prospect_id: 'p-ok',
            occurred_at: '2026-05-01T10:00:00Z',
            type: 'rdv',
            notes: null,
            callback_date: '2026-06-01T09:00:00Z',
            callback_done: false,
            prospect: { id: 'p-ok', raison_sociale: 'OK', siren: null },
          },
          // Pas de prospect joinable
          {
            id: 'ex-no-prosp',
            prospect_id: 'p-x',
            occurred_at: '2026-05-01T10:00:00Z',
            type: 'rdv',
            notes: null,
            callback_date: '2026-06-01T09:00:00Z',
            callback_done: false,
            prospect: null,
          },
          // Pas de callback_date (devrait pas remonter du fetch mais on
          // verifie la robustesse du flatMap)
          {
            id: 'ex-no-cb',
            prospect_id: 'p-ok',
            occurred_at: '2026-05-01T10:00:00Z',
            type: 'rdv',
            notes: null,
            callback_date: null,
            callback_done: false,
            prospect: { id: 'p-ok', raison_sociale: 'OK', siren: null },
          },
        ],
        error: null,
      }),
    )

    const { default: CalendarPage } = await import('./page')
    const node = (await CalendarPage()) as ReactElement
    render(node)

    expect(Array.isArray(capturedProps.events)).toBe(true)
    const events = capturedProps.events as { id: string }[]
    expect(events.map((e) => e.id)).toEqual(['ex-ok'])
  })

  it('fallback : si callback_done manquant en DB (migration 014), retente sans le filtre', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })

    // Premier appel from() : tente la query avec callback_done -> erreur 42703
    // (column does not exist). Deuxieme appel : query fallback sans le filtre,
    // OK.
    const firstResult = {
      data: null,
      error: { code: '42703', message: 'column callback_done does not exist' },
    }
    const fallbackResult = {
      data: [
        {
          id: 'ex-fb',
          prospect_id: 'p-fb',
          occurred_at: '2026-05-01T10:00:00Z',
          type: 'linkedin',
          notes: null,
          callback_date: '2026-06-01T09:00:00Z',
          prospect: { id: 'p-fb', raison_sociale: 'Fallback', siren: null },
        },
      ],
      error: null,
    }
    fromMock
      .mockReturnValueOnce(buildFromChain(firstResult))
      .mockReturnValueOnce(buildFromChain(fallbackResult))

    const { default: CalendarPage } = await import('./page')
    const node = (await CalendarPage()) as ReactElement
    render(node)

    const events = capturedProps.events as { id: string }[]
    expect(events).toHaveLength(1)
    expect(events[0].id).toBe('ex-fb')
  })

  it('renvoie [] si la query echoue pour une autre raison (DB down)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })

    fromMock.mockReturnValueOnce(
      buildFromChain({
        data: null,
        error: { code: 'XX000', message: 'internal_error' },
      }),
    )

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { default: CalendarPage } = await import('./page')
    const node = (await CalendarPage()) as ReactElement
    render(node)

    expect(capturedProps.events).toEqual([])
    warnSpy.mockRestore()
  })
})
