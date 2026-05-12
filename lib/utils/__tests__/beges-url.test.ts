// ============================================================
// Tests — lib/utils/beges-url.ts
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildBegesUrl } from '../beges-url'

describe('buildBegesUrl', () => {
  it('retourne l\'URL stockée si elle pointe vers une fiche bilans-ges', () => {
    const url = buildBegesUrl({
      beges_url: 'https://bilans-ges.ademe.fr/bilans/abc123',
      siren: '123456789',
    })
    expect(url).toBe('https://bilans-ges.ademe.fr/bilans/abc123')
  })

  it('fallback siren-based quand beges_url est undefined', () => {
    const url = buildBegesUrl({ beges_url: undefined, siren: '123456789' })
    expect(url).toBe('https://bilans-ges.ademe.fr/bilans?q=123456789')
  })

  it('fallback siren-based quand beges_url est une chaîne vide', () => {
    const url = buildBegesUrl({ beges_url: '', siren: '123456789' })
    expect(url).toBe('https://bilans-ges.ademe.fr/bilans?q=123456789')
  })

  it('fallback siren-based quand beges_url pointe vers la home ADEME', () => {
    const url = buildBegesUrl({
      beges_url: 'https://www.ademe.fr',
      siren: '123456789',
    })
    expect(url).toBe('https://bilans-ges.ademe.fr/bilans?q=123456789')
  })

  it('fallback siren-based quand beges_url pointe vers bilans-ges sans fiche', () => {
    const url = buildBegesUrl({
      beges_url: 'https://bilans-ges.ademe.fr',
      siren: '987654321',
    })
    expect(url).toBe('https://bilans-ges.ademe.fr/bilans?q=987654321')
  })

  it('fallback siren-based quand beges_url pointe vers /bilans/ sans id', () => {
    const url = buildBegesUrl({
      beges_url: 'https://bilans-ges.ademe.fr/bilans/',
      siren: '987654321',
    })
    expect(url).toBe('https://bilans-ges.ademe.fr/bilans?q=987654321')
  })

  it('rejette une URL non http(s)', () => {
    const url = buildBegesUrl({
      beges_url: 'javascript:alert(1)',
      siren: '123456789',
    })
    expect(url).toBe('https://bilans-ges.ademe.fr/bilans?q=123456789')
  })

  it('retourne null si pas de SIREN valide et pas de beges_url', () => {
    const url = buildBegesUrl({ beges_url: undefined, siren: '' })
    expect(url).toBeNull()
  })

  it('retourne null si SIREN mal formé et pas de beges_url', () => {
    const url = buildBegesUrl({ beges_url: undefined, siren: 'ABC123' })
    expect(url).toBeNull()
  })

  it('SIREN trop court → fallback impossible → null', () => {
    const url = buildBegesUrl({ beges_url: '', siren: '12345' })
    expect(url).toBeNull()
  })

  it('accepte un autre domaine que bilans-ges si l\'URL semble être une fiche', () => {
    // Permet à un usager de mettre une URL custom (rapport PDF, intranet, etc.)
    const url = buildBegesUrl({
      beges_url: 'https://example.com/rapport-rse-2024.pdf',
      siren: '123456789',
    })
    expect(url).toBe('https://example.com/rapport-rse-2024.pdf')
  })
})
