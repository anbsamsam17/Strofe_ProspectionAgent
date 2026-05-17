// ============================================================
// TESTS UNITAIRES — sourcing.ts / buildLuceneQuery + normalizeNafCodes
// ------------------------------------------------------------
// Bug prod 2026-05-17 (soir) : Sirene v3.11 répondait HTTP 400 "Erreur de
// syntaxe dans le paramètre q" car les tokens NAF étaient envoyés SANS point
// (`0121Z`) alors que l'index Solr stocke les codes AVEC point (`01.21Z`).
//
// Tentative intermédiaire (2026-05-17 matin) : ajouter un quoting défensif
// `"01.21Z"` autour des valeurs. AGGRAVE le 400 car Solr `string` field ne
// supporte pas la phrase-search. Format final : non quoté + point natif,
// conforme à la lib Python sne3ks/api_insee (oracle officiel).
//
// Stratégie de test :
//   - Pas de fetch réel — on teste les helpers purs `buildLuceneQuery` et
//     `normalizeNafCodes` directement (exportés depuis sourcing.ts).
//   - Couverture : query nominale, défense contre caractères spéciaux,
//     conditionnalité des clauses (anti-`champ:()`), ordre stable des
//     tokens (NAF préservé, tranches triées).
// ============================================================

import { describe, expect, it } from 'vitest'
import { buildLuceneQuery, normalizeNafCodes } from '../sourcing'

describe('normalizeNafCodes — format canonique Sirene (avec point)', () => {
  it('conserve le point dans les codes NAF format `01.21Z` (format Sirene natif)', () => {
    const out = normalizeNafCodes(['01.21Z', '49.41A'])
    expect(out).toEqual(['01.21Z', '49.41A'])
  })

  it('insère le point pour un code legacy `0121Z` → `01.21Z`', () => {
    const out = normalizeNafCodes(['0121Z'])
    expect(out).toEqual(['01.21Z'])
  })

  it('uppercase + insère le point pour `01.21z` → `01.21Z`', () => {
    const out = normalizeNafCodes(['01.21z'])
    expect(out).toEqual(['01.21Z'])
  })

  it('déduplique en préservant l\'ordre d\'entrée (stabilité du chunking)', () => {
    // `0121Z` (legacy) et `01.21Z` (canonique) doivent dédup vers la forme canonique.
    const out = normalizeNafCodes(['01.21Z', '49.41A', '01.21Z', '0121Z'])
    expect(out).toEqual(['01.21Z', '49.41A'])
  })

  it('rejette un code NAF contenant un caractère Solr réservé (anti-HTTP 400)', () => {
    // Cas synthétiques — un code NAF valide n'a pas ces caractères, mais une donnée
    // corrompue (libellé humain, copie-coller HTML) peut en contenir. Le point `.`
    // n'est PAS dans SOLR_RESERVED_CHARS (format canonique NAF).
    const out = normalizeNafCodes(['01:21Z', '01(21Z', '01*21Z', '01+21Z', '01\\21Z', '01 21Z'])
    expect(out).toEqual([])
  })

  it('trim les espaces périphériques (`  01.21Z  ` → `01.21Z`)', () => {
    const out = normalizeNafCodes(['  01.21Z  '])
    expect(out).toEqual(['01.21Z'])
  })

  it('filtre les entrées vides et les non-strings', () => {
    // `as unknown as string[]` pour simuler un input mal typé venant de JSON externe.
    const out = normalizeNafCodes(['', '  ', 'VALID01' as string, null as unknown as string])
    expect(out).toEqual(['VALID01'])
  })
})

describe('buildLuceneQuery — format Sirene v3.11 (oracle lib Python api_insee)', () => {
  it('always inclut etatAdministratifEtablissement:A non quoté (invariant anti-`q=`)', () => {
    const q = buildLuceneQuery([], [], ['00000', '99999'])
    expect(q).toContain('etatAdministratifEtablissement:A')
    expect(q).not.toContain('etatAdministratifEtablissement:"A"')
  })

  it('codes NAF AVEC POINT, NON quotés dans la clause OR (format Solr `string` field)', () => {
    const q = buildLuceneQuery(['01.21Z', '49.41A'], ['21', '22'], ['33000', '33999'])
    expect(q).toContain('activitePrincipaleEtablissement:(01.21Z OR 49.41A)')
  })

  it('tranches d\'effectif NON quotées (cohérence avec NAF + Solr `string` field)', () => {
    const q = buildLuceneQuery(['01.21Z'], ['21', '22'], ['00000', '99999'])
    expect(q).toContain('trancheEffectifsEtablissement:(21 OR 22)')
  })

  it('trie les tranches (déterminisme query — stable entre runs)', () => {
    const q = buildLuceneQuery(['01.21Z'], ['52', '21', '41', '22'], ['00000', '99999'])
    expect(q).toContain('trancheEffectifsEtablissement:(21 OR 22 OR 41 OR 52)')
  })

  it('omet la clause NAF si la liste est vide (anti-`activitePrincipaleEtablissement:()`)', () => {
    const q = buildLuceneQuery([], ['21'], ['00000', '99999'])
    expect(q).not.toContain('activitePrincipaleEtablissement:')
  })

  it('omet la clause tranches si la liste est vide (anti-`()` 400)', () => {
    const q = buildLuceneQuery(['01.21Z'], [], ['00000', '99999'])
    expect(q).not.toContain('trancheEffectifsEtablissement:')
  })

  it('omet la clause code postal si une borne est invalide (anti-`[ TO ]` 400)', () => {
    const q = buildLuceneQuery(['01.21Z'], ['21'], ['abc', '99999'])
    expect(q).not.toContain('codePostalEtablissement:[')
  })

  it('inclut codePostalEtablissement:[33000 TO 33999] quand range valide (Solr range nu)', () => {
    const q = buildLuceneQuery(['01.21Z'], ['21'], ['33000', '33999'])
    expect(q).toContain('codePostalEtablissement:[33000 TO 33999]')
  })

  it('assemble les clauses avec AND (jamais de OR top-level — anti précédence)', () => {
    const q = buildLuceneQuery(['01.21Z'], ['21'], ['33000', '33999'])
    // 4 clauses : etat + cp + tranche + naf → 3 AND.
    const andCount = (q.match(/ AND /g) ?? []).length
    expect(andCount).toBe(3)
  })

  it('produit une query valide même avec UN SEUL code NAF (case minimal)', () => {
    // Range CP invalide volontairement (borne 'X') pour skip la clause CP et tester le minimum.
    const q = buildLuceneQuery(['01.21Z'], [], ['X', '99999'])
    expect(q).toBe('etatAdministratifEtablissement:A AND activitePrincipaleEtablissement:(01.21Z)')
  })

  it('rejette les tranches contenant des caractères Solr réservés (défense en profondeur)', () => {
    const q = buildLuceneQuery(['01.21Z'], ['21*', '22', '23:bad'], ['00000', '99999'])
    expect(q).toContain('trancheEffectifsEtablissement:(22)')
    expect(q).not.toContain('21*')
    expect(q).not.toContain('23:bad')
  })

  it('produit une query de longueur raisonnable pour 20 NAF (sous 8KB Solr)', () => {
    // 20 NAF au format canonique `LL.NNZ` (5 chars NAF nu → 6 chars avec point).
    const naf20 = Array.from(
      { length: 20 },
      (_, i) => `${String(i).padStart(2, '0')}.00Z`,
    )
    const q = buildLuceneQuery(
      naf20,
      ['21', '22', '31', '32', '41', '42', '51', '52', '53'],
      ['00000', '99999'],
    )
    // Approx : 30 (etat) + 5 (AND) + 36 (cp) + 5 + ~50 (tranches non quotées) + 5 + ~160 (naf non quoté) ≈ 300.
    expect(q.length).toBeLessThan(500)
  })
})
