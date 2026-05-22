// ============================================================
// TESTS — appendRgpdFooter (GLN-003)
// ============================================================

import { describe, it, expect } from 'vitest'
import { ART14_FOOTER, appendRgpdFooter } from './rgpd'

describe('appendRgpdFooter', () => {
  const OPT_OUT_URL = 'https://example.com/api/opt-out/abc.xyz'

  it('ajoute le footer art. 14 à un corps simple', () => {
    const out = appendRgpdFooter('Bonjour, voici mon message.', OPT_OUT_URL)
    expect(out).toContain('Conformément à l\'article 14 du RGPD')
    expect(out).toContain('STROFE')
    expect(out).toContain('Art. L. 229-25')
  })

  it('interpole {{opt_out_link}} avec l\'URL fournie', () => {
    const out = appendRgpdFooter('Bonjour.', OPT_OUT_URL)
    expect(out).toContain(OPT_OUT_URL)
    expect(out).not.toContain('{{opt_out_link}}')
  })

  it('ne duplique pas le footer si déjà présent (idempotence)', () => {
    const once = appendRgpdFooter('Bonjour.', OPT_OUT_URL)
    const twice = appendRgpdFooter(once, OPT_OUT_URL)
    expect(twice).toBe(once)
    // Aussi vérifier qu'il n'y a qu'une occurrence
    const matches = twice.match(/Conformément à l'article 14 du RGPD/g)
    expect(matches?.length).toBe(1)
  })

  it('sépare le corps du footer par une ligne vide', () => {
    const out = appendRgpdFooter('Bonjour.', OPT_OUT_URL)
    expect(out).toContain('Bonjour.\n\n')
  })

  it('trim les espaces de fin du corps avant insertion', () => {
    const out = appendRgpdFooter('Bonjour.   \n\n\n', OPT_OUT_URL)
    expect(out).toContain('Bonjour.\n\n──────────')
  })

  it('expose la constante ART14_FOOTER pour usage externe', () => {
    expect(ART14_FOOTER).toContain('Conformément à l\'article 14 du RGPD')
    expect(ART14_FOOTER).toContain('{{opt_out_link}}')
  })
})
