// ============================================================
// TESTS — lib/observability/sentry-helpers.ts
//
// Couvre :
//   - scrubPiiString : remplacement emails + téléphones (FR, +33, E.164)
//   - scrubSentryEvent : scrub récursif sur exception/breadcrumbs/extra/contexts
//   - captureWithContext : tags pipeline_phase/api/run_id + user.id, extras
//   - shouldReportFailure : 1ère erreur + 1 toutes les N (anti-spam)
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock du SDK Sentry AVANT import du module testé (sinon withScope/captureException
// sont déjà bound à la vraie impl. au moment de l'évaluation).
vi.mock('@sentry/nextjs', () => {
  const scope = {
    setTag: vi.fn(),
    setUser: vi.fn(),
    setExtra: vi.fn(),
  }
  return {
    captureException: vi.fn(),
    withScope: vi.fn((cb: (s: typeof scope) => void) => cb(scope)),
    __scope: scope,
  }
})

import * as Sentry from '@sentry/nextjs'
import {
  _resetAllFailureCountersForTests,
  captureWithContext,
  scrubPiiString,
  scrubSentryEvent,
  shouldReportFailure,
} from '../sentry-helpers'

// Récupère le scope mocké en bypassant le typage public de Sentry.
const mockedScope = (Sentry as unknown as {
  __scope: {
    setTag: ReturnType<typeof vi.fn>
    setUser: ReturnType<typeof vi.fn>
    setExtra: ReturnType<typeof vi.fn>
  }
}).__scope
const mockedCaptureException = Sentry.captureException as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  _resetAllFailureCountersForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ------------------------------------------------------------
// scrubPiiString
// ------------------------------------------------------------

describe('scrubPiiString', () => {
  it('remplace un email simple par [email]', () => {
    expect(scrubPiiString('Contact: jean.dupont@example.com pour info')).toBe(
      'Contact: [email] pour info',
    )
  })

  it('remplace plusieurs emails dans une même chaîne', () => {
    const input = 'From a@b.fr to c.d@e.io please reply'
    expect(scrubPiiString(input)).toBe('From [email] to [email] please reply')
  })

  it('remplace un numéro FR au format 06 12 34 56 78', () => {
    expect(scrubPiiString('Tel: 06 12 34 56 78')).toBe('Tel: [phone]')
  })

  it('remplace un numéro FR au format 0612345678 (sans séparateur)', () => {
    expect(scrubPiiString('Appeler 0612345678 svp')).toBe('Appeler [phone] svp')
  })

  it('remplace un numéro au format +33 6 12 34 56 78', () => {
    expect(scrubPiiString('Mobile +33 6 12 34 56 78')).toBe('Mobile [phone]')
  })

  it('remplace un numéro E.164 international (+44...)', () => {
    expect(scrubPiiString('UK: +442071234567')).toBe('UK: [phone]')
  })

  it('NE remplace PAS un SIREN à 9 chiffres', () => {
    // Un SIREN n'est pas un téléphone (9 chiffres, pas 10) — il doit passer intact.
    expect(scrubPiiString('SIREN 123456789 entreprise')).toBe('SIREN 123456789 entreprise')
  })

  it('préserve les messages d\'erreur Sirene (pas de PII attendue dedans)', () => {
    const input = 'Sirene: HTTP 400 page 1 curseur=* body=Erreur de syntaxe dans le paramètre q'
    expect(scrubPiiString(input)).toBe(input)
  })

  it('renvoie une chaîne vide pour une chaîne vide', () => {
    expect(scrubPiiString('')).toBe('')
  })
})

// ------------------------------------------------------------
// scrubSentryEvent
// ------------------------------------------------------------

describe('scrubSentryEvent', () => {
  it('scrub les emails dans exception.values[].value', () => {
    const event = {
      type: 'error' as const,
      event_id: 'e1',
      exception: {
        values: [
          { type: 'Error', value: 'fetch failed for user@example.com' },
        ],
      },
    }
    // Cast intermédiaire vers ErrorEvent (test isolé du SDK)
    const out = scrubSentryEvent(event as unknown as Parameters<typeof scrubSentryEvent>[0])
    expect(out.exception?.values?.[0]?.value).toBe('fetch failed for [email]')
  })

  it('scrub récursivement extra.* et contexts.*', () => {
    const event = {
      type: 'error' as const,
      event_id: 'e2',
      extra: {
        prospect_email: 'lead@firm.fr',
        nested: { phone: '06 11 22 33 44', siren: '123456789' },
      },
      contexts: {
        custom: { email: 'a@b.com' },
      },
    }
    const out = scrubSentryEvent(event as unknown as Parameters<typeof scrubSentryEvent>[0])
    expect(out.extra?.prospect_email).toBe('[email]')
    expect((out.extra?.nested as { phone: string; siren: string }).phone).toBe('[phone]')
    expect((out.extra?.nested as { phone: string; siren: string }).siren).toBe('123456789')
    expect((out.contexts?.custom as { email: string }).email).toBe('[email]')
  })

  it('scrub les breadcrumbs.message et breadcrumbs.data', () => {
    const event = {
      type: 'error' as const,
      event_id: 'e3',
      breadcrumbs: [
        { message: 'envoi à client@boite.com', data: { to: 'cc@boite.com' } },
      ],
    }
    const out = scrubSentryEvent(event as unknown as Parameters<typeof scrubSentryEvent>[0])
    expect(out.breadcrumbs?.[0]?.message).toBe('envoi à [email]')
    expect((out.breadcrumbs?.[0]?.data as { to: string }).to).toBe('[email]')
  })

  it('ne modifie pas un event sans PII', () => {
    const event = {
      type: 'error' as const,
      event_id: 'e4',
      exception: {
        values: [{ type: 'SireneApiError', value: 'Sirene: HTTP 400 — Erreur de syntaxe' }],
      },
    }
    const out = scrubSentryEvent(event as unknown as Parameters<typeof scrubSentryEvent>[0])
    expect(out.exception?.values?.[0]?.value).toBe('Sirene: HTTP 400 — Erreur de syntaxe')
  })
})

// ------------------------------------------------------------
// captureWithContext
// ------------------------------------------------------------

describe('captureWithContext', () => {
  it('appelle captureException avec les tags normalisés', () => {
    const err = new Error('boom')

    captureWithContext(err, {
      pipeline_phase: 'sourcing',
      api: 'sirene',
      run_id: 'run-abc',
      user_id: 'user-xyz',
      http_status: 400,
      extra: { curseur: '*', page: 1 },
    })

    expect(mockedCaptureException).toHaveBeenCalledTimes(1)
    expect(mockedCaptureException).toHaveBeenCalledWith(err)

    expect(mockedScope.setTag).toHaveBeenCalledWith('pipeline_phase', 'sourcing')
    expect(mockedScope.setTag).toHaveBeenCalledWith('api', 'sirene')
    expect(mockedScope.setTag).toHaveBeenCalledWith('run_id', 'run-abc')
    expect(mockedScope.setTag).toHaveBeenCalledWith('http_status', '400')
    expect(mockedScope.setUser).toHaveBeenCalledWith({ id: 'user-xyz' })
    expect(mockedScope.setExtra).toHaveBeenCalledWith('curseur', '*')
    expect(mockedScope.setExtra).toHaveBeenCalledWith('page', 1)
  })

  it('ne pose pas de tag api si non fourni', () => {
    captureWithContext(new Error('x'), { pipeline_phase: 'pitch' })
    expect(mockedScope.setTag).toHaveBeenCalledWith('pipeline_phase', 'pitch')
    const apiCalls = mockedScope.setTag.mock.calls.filter((c: unknown[]) => c[0] === 'api')
    expect(apiCalls).toHaveLength(0)
  })

  it('ne pose pas user.id si user_id absent', () => {
    captureWithContext(new Error('x'), { pipeline_phase: 'sourcing' })
    expect(mockedScope.setUser).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------
// shouldReportFailure
// ------------------------------------------------------------

describe('shouldReportFailure', () => {
  it('renvoie true sur la 1ère occurrence', () => {
    expect(shouldReportFailure('a', 'run-1', 5)).toBe(true)
  })

  it('renvoie false sur les occurrences 2 à 4 (avant le seuil)', () => {
    shouldReportFailure('b', 'run-1', 5) // 1
    expect(shouldReportFailure('b', 'run-1', 5)).toBe(false) // 2
    expect(shouldReportFailure('b', 'run-1', 5)).toBe(false) // 3
    expect(shouldReportFailure('b', 'run-1', 5)).toBe(false) // 4
  })

  it('renvoie true sur la 5e occurrence (multiple de reportEvery=5)', () => {
    for (let i = 0; i < 4; i++) shouldReportFailure('c', 'run-1', 5)
    expect(shouldReportFailure('c', 'run-1', 5)).toBe(true) // 5
  })

  it('compte indépendamment par runId (isolation des runs)', () => {
    expect(shouldReportFailure('d', 'run-A', 5)).toBe(true) // run-A: 1
    expect(shouldReportFailure('d', 'run-A', 5)).toBe(false) // run-A: 2
    expect(shouldReportFailure('d', 'run-B', 5)).toBe(true) // run-B: 1 → toujours true
  })
})
