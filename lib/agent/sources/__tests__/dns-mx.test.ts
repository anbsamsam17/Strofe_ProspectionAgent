// ============================================================
// Tests — lib/agent/sources/dns-mx.ts
// Mock complet de node:dns (offline determinism, cf. rules/testing.md).
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock node:dns AVANT l'import du module testé.
const resolveMxMock = vi.fn()
vi.mock('node:dns', () => {
  const promises = {
    resolveMx: (domain: string) => resolveMxMock(domain),
  }
  return {
    default: { promises },
    promises,
  }
})

import {
  _resetMxCache,
  getMxRecords,
  hasMxRecord,
  identifyMxProvider,
  type MxRecord,
} from '../dns-mx'

function enotfound(): NodeJS.ErrnoException {
  const e = new Error('queryMx ENOTFOUND') as NodeJS.ErrnoException
  e.code = 'ENOTFOUND'
  return e
}

function enodata(): NodeJS.ErrnoException {
  const e = new Error('queryMx ENODATA') as NodeJS.ErrnoException
  e.code = 'ENODATA'
  return e
}

function etimedout(): NodeJS.ErrnoException {
  const e = new Error('queryMx ETIMEDOUT') as NodeJS.ErrnoException
  e.code = 'ETIMEDOUT'
  return e
}

beforeEach(() => {
  _resetMxCache()
  resolveMxMock.mockReset()
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('hasMxRecord', () => {
  it('retourne true quand le domaine a au moins 1 MX record', async () => {
    resolveMxMock.mockResolvedValueOnce([
      { exchange: 'aspmx.l.google.com', priority: 1 },
      { exchange: 'alt1.aspmx.l.google.com', priority: 5 },
    ])
    await expect(hasMxRecord('example.com')).resolves.toBe(true)
    expect(resolveMxMock).toHaveBeenCalledWith('example.com')
  })

  it('retourne false quand la liste de MX est vide', async () => {
    resolveMxMock.mockResolvedValueOnce([])
    await expect(hasMxRecord('empty.test')).resolves.toBe(false)
  })

  it('retourne false sur ENOTFOUND (et met en cache)', async () => {
    resolveMxMock.mockRejectedValueOnce(enotfound())
    await expect(hasMxRecord('nope.invalid')).resolves.toBe(false)

    // 2e appel : doit hit le cache, pas relancer resolveMx.
    await expect(hasMxRecord('nope.invalid')).resolves.toBe(false)
    expect(resolveMxMock).toHaveBeenCalledTimes(1)
  })

  it('retourne false sur ENODATA (et met en cache)', async () => {
    resolveMxMock.mockRejectedValueOnce(enodata())
    await expect(hasMxRecord('no-mx.test')).resolves.toBe(false)
    await expect(hasMxRecord('no-mx.test')).resolves.toBe(false)
    expect(resolveMxMock).toHaveBeenCalledTimes(1)
  })

  it('retourne false sur ETIMEDOUT (PAS mis en cache)', async () => {
    resolveMxMock.mockRejectedValueOnce(etimedout())
    await expect(hasMxRecord('slow.test')).resolves.toBe(false)

    // 2e appel doit relancer resolveMx (pas de cache sur timeout).
    resolveMxMock.mockResolvedValueOnce([{ exchange: 'mx.slow.test', priority: 10 }])
    await expect(hasMxRecord('slow.test')).resolves.toBe(true)
    expect(resolveMxMock).toHaveBeenCalledTimes(2)
  })

  it('cache hit : 2 appels même domaine = 1 seul resolveMx', async () => {
    resolveMxMock.mockResolvedValueOnce([{ exchange: 'mx.cached.test', priority: 10 }])
    await expect(hasMxRecord('cached.test')).resolves.toBe(true)
    await expect(hasMxRecord('cached.test')).resolves.toBe(true)
    await expect(hasMxRecord('cached.test')).resolves.toBe(true)
    expect(resolveMxMock).toHaveBeenCalledTimes(1)
  })

  it('cache expiry : refetch après TTL 24h', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    resolveMxMock.mockResolvedValueOnce([{ exchange: 'mx.ttl.test', priority: 10 }])
    await expect(hasMxRecord('ttl.test')).resolves.toBe(true)
    expect(resolveMxMock).toHaveBeenCalledTimes(1)

    // Avance de 23h59 : encore caché.
    vi.setSystemTime(new Date('2026-01-01T23:59:00Z'))
    await expect(hasMxRecord('ttl.test')).resolves.toBe(true)
    expect(resolveMxMock).toHaveBeenCalledTimes(1)

    // Avance >24h : doit refetch.
    vi.setSystemTime(new Date('2026-01-02T00:01:00Z'))
    resolveMxMock.mockResolvedValueOnce([{ exchange: 'mx.ttl.test', priority: 10 }])
    await expect(hasMxRecord('ttl.test')).resolves.toBe(true)
    expect(resolveMxMock).toHaveBeenCalledTimes(2)
  })

  it("strip le protocole https:// avant le lookup", async () => {
    resolveMxMock.mockResolvedValueOnce([{ exchange: 'mx.acme.fr', priority: 10 }])
    await expect(hasMxRecord('https://acme.fr/path')).resolves.toBe(true)
    expect(resolveMxMock).toHaveBeenCalledWith('acme.fr')
  })

  it('normalise les domaines uppercase en lowercase', async () => {
    resolveMxMock.mockResolvedValueOnce([{ exchange: 'mx.acme.fr', priority: 10 }])
    await expect(hasMxRecord('ACME.FR')).resolves.toBe(true)
    expect(resolveMxMock).toHaveBeenCalledWith('acme.fr')

    // 2e appel avec casse mixte hit le cache normalisé.
    await expect(hasMxRecord('Acme.Fr')).resolves.toBe(true)
    expect(resolveMxMock).toHaveBeenCalledTimes(1)
  })

  it('jette sur input vide', async () => {
    await expect(hasMxRecord('')).rejects.toThrow()
    await expect(hasMxRecord('   ')).rejects.toThrow()
  })

  it("strip user@ si un email entier est passé", async () => {
    resolveMxMock.mockResolvedValueOnce([{ exchange: 'mx.acme.fr', priority: 10 }])
    await expect(hasMxRecord('john.doe@acme.fr')).resolves.toBe(true)
    expect(resolveMxMock).toHaveBeenCalledWith('acme.fr')
  })

  it('retourne false sur erreur DNS inconnue (sans cache)', async () => {
    const weird = new Error('weird') as NodeJS.ErrnoException
    weird.code = 'ESERVFAIL'
    resolveMxMock.mockRejectedValueOnce(weird)
    await expect(hasMxRecord('weird.test')).resolves.toBe(false)

    // Pas caché : retry possible.
    resolveMxMock.mockResolvedValueOnce([{ exchange: 'mx.weird.test', priority: 10 }])
    await expect(hasMxRecord('weird.test')).resolves.toBe(true)
    expect(resolveMxMock).toHaveBeenCalledTimes(2)
  })
})

describe('getMxRecords', () => {
  it('retourne les MX triés par priorité ascendante', async () => {
    resolveMxMock.mockResolvedValueOnce([
      { exchange: 'alt2.aspmx.l.google.com', priority: 10 },
      { exchange: 'aspmx.l.google.com', priority: 1 },
      { exchange: 'alt1.aspmx.l.google.com', priority: 5 },
    ])
    const records = await getMxRecords('example.com')
    expect(records.map((r) => r.priority)).toEqual([1, 5, 10])
    expect(records[0].exchange).toBe('aspmx.l.google.com')
  })

  it('retourne [] sur erreur DNS', async () => {
    resolveMxMock.mockRejectedValueOnce(enotfound())
    await expect(getMxRecords('nope.invalid')).resolves.toEqual([])
  })
})

describe('identifyMxProvider', () => {
  it('détecte Google (aspmx.l.google.com)', () => {
    const records: MxRecord[] = [
      { exchange: 'aspmx.l.google.com', priority: 1 },
      { exchange: 'alt1.aspmx.l.google.com', priority: 5 },
    ]
    expect(identifyMxProvider(records)).toBe('google')
  })

  it('détecte Microsoft (mail.protection.outlook.com)', () => {
    const records: MxRecord[] = [
      { exchange: 'acme-fr.mail.protection.outlook.com', priority: 0 },
    ]
    expect(identifyMxProvider(records)).toBe('microsoft')
  })

  it('détecte OVH', () => {
    expect(
      identifyMxProvider([{ exchange: 'mx1.mail.ovh.net', priority: 1 }]),
    ).toBe('ovh')
  })

  it('détecte Gandi', () => {
    expect(
      identifyMxProvider([{ exchange: 'spool.mail.gandi.net', priority: 10 }]),
    ).toBe('gandi')
  })

  it('détecte SendGrid', () => {
    expect(
      identifyMxProvider([{ exchange: 'mx.sendgrid.net', priority: 10 }]),
    ).toBe('sendgrid')
  })

  it('détecte Mailgun', () => {
    expect(
      identifyMxProvider([{ exchange: 'mxa.mailgun.org', priority: 10 }]),
    ).toBe('mailgun')
  })

  it("retourne 'other' pour un provider inconnu", () => {
    const records: MxRecord[] = [
      { exchange: 'mx.exotic-host.example', priority: 10 },
    ]
    expect(identifyMxProvider(records)).toBe('other')
  })

  it('retourne null sur liste vide', () => {
    expect(identifyMxProvider([])).toBeNull()
  })

  it('utilise le MX de priorité la plus basse pour identifier', () => {
    // Le primary (priority=1) est Google ; un secondaire OVH ne doit pas confondre.
    const records: MxRecord[] = [
      { exchange: 'mx1.mail.ovh.net', priority: 50 },
      { exchange: 'aspmx.l.google.com', priority: 1 },
    ]
    expect(identifyMxProvider(records)).toBe('google')
  })
})
