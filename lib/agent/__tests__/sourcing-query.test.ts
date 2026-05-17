// ============================================================
// TESTS UNITAIRES — sourcing.ts / buildLuceneQuery + normalizeNafCodes
// ------------------------------------------------------------
// Bug prod 2026-05-17 : Sirene v3.11 répondait HTTP 400 "Erreur de syntaxe
// dans le paramètre q" même après le fix `4c73d01` (filtres conditionnels).
// Hypothèse retenue : tokens alphanumériques non quotés (ex. `0121Z`) parsés
// par Solr comme expressions Lucene (ranges, suffix wildcard) au lieu de
// littéraux. Fix : quoting défensif systématique des valeurs string + rejet
// strict des caractères Solr réservés en amont (normalizeNafCodes).
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

describe('normalizeNafCodes — rejet caractères Solr réservés', () => {
  it('normalise les codes NAF format `01.21Z` → `0121Z` (point stripé, uppercase)', () => {
    const out = normalizeNafCodes(['01.21Z', '49.41A'])
    expect(out).toEqual(['0121Z', '4941A'])
  })

  it('déduplique en préservant l\'ordre d\'entrée (stabilité du chunking)', () => {
    const out = normalizeNafCodes(['01.21Z', '49.41A', '01.21Z', '0121Z'])
    expect(out).toEqual(['0121Z', '4941A'])
  })

  it('rejette un code NAF contenant un caractère Solr réservé (anti-HTTP 400)', () => {
    // Cas synthétiques — un code NAF valide n'a pas ces caractères, mais une donnée
    // corrompue (libellé humain, copie-coller HTML) peut en contenir.
    const out = normalizeNafCodes(['01:21Z', '01(21Z', '01*21Z', '01+21Z', '01\\21Z', '01 21Z'])
    expect(out).toEqual([])
  })

  it('retire les points MULTIPLES (regression `.replace` legacy ne supprimait que le premier)', () => {
    const out = normalizeNafCodes(['01.21.Z'])
    expect(out).toEqual(['0121Z'])
  })

  it('filtre les entrées vides et les non-strings', () => {
    // `as unknown as string[]` pour simuler un input mal typé venant de JSON externe.
    const out = normalizeNafCodes(['', '  ', 'valid01' as string, null as unknown as string])
    expect(out).toEqual(['VALID01'])
  })
})

describe('buildLuceneQuery — quoting défensif anti-HTTP 400 Sirene', () => {
  it('always inclut etatAdministratifEtablissement:"A" (invariant anti-`q=`)', () => {
    const q = buildLuceneQuery([], [], ['00000', '99999'])
    expect(q).toContain('etatAdministratifEtablissement:"A"')
  })

  it('quote les codes NAF dans la clause OR (fix HTTP 400 tokens alphanumériques)', () => {
    const q = buildLuceneQuery(['0121Z', '4941A'], ['21', '22'], ['33000', '33999'])
    expect(q).toContain('activitePrincipaleEtablissement:("0121Z" OR "4941A")')
  })

  it('quote les tranches d\'effectif (cohérence avec NAF)', () => {
    const q = buildLuceneQuery(['0121Z'], ['21', '22'], ['00000', '99999'])
    expect(q).toContain('trancheEffectifsEtablissement:("21" OR "22")')
  })

  it('trie les tranches (déterminisme query — stable entre runs)', () => {
    const q = buildLuceneQuery(['0121Z'], ['52', '21', '41', '22'], ['00000', '99999'])
    expect(q).toContain('trancheEffectifsEtablissement:("21" OR "22" OR "41" OR "52")')
  })

  it('omet la clause NAF si la liste est vide (anti-`activitePrincipaleEtablissement:()`)', () => {
    const q = buildLuceneQuery([], ['21'], ['00000', '99999'])
    expect(q).not.toContain('activitePrincipaleEtablissement:')
  })

  it('omet la clause tranches si la liste est vide (anti-`()` 400)', () => {
    const q = buildLuceneQuery(['0121Z'], [], ['00000', '99999'])
    expect(q).not.toContain('trancheEffectifsEtablissement:')
  })

  it('omet la clause code postal si une borne est invalide (anti-`[ TO ]` 400)', () => {
    const q = buildLuceneQuery(['0121Z'], ['21'], ['abc', '99999'])
    expect(q).not.toContain('codePostalEtablissement:[')
  })

  it('inclut codePostalEtablissement:[33000 TO 33999] quand range valide (pas de quoting — Solr range)', () => {
    const q = buildLuceneQuery(['0121Z'], ['21'], ['33000', '33999'])
    expect(q).toContain('codePostalEtablissement:[33000 TO 33999]')
  })

  it('assemble les clauses avec AND (jamais de OR top-level — anti précédence)', () => {
    const q = buildLuceneQuery(['0121Z'], ['21'], ['33000', '33999'])
    // 4 clauses : etat + cp + tranche + naf → 3 AND.
    const andCount = (q.match(/ AND /g) ?? []).length
    expect(andCount).toBe(3)
  })

  it('produit une query valide même avec UN SEUL code NAF (case minimal)', () => {
    // Range CP invalide volontairement (borne 'X') pour skip la clause CP et tester le minimum.
    const q = buildLuceneQuery(['0121Z'], [], ['X', '99999'])
    expect(q).toBe('etatAdministratifEtablissement:"A" AND activitePrincipaleEtablissement:("0121Z")')
  })

  it('rejette les tranches contenant des caractères Solr réservés (défense en profondeur)', () => {
    const q = buildLuceneQuery(['0121Z'], ['21*', '22', '23:bad'], ['00000', '99999'])
    expect(q).toContain('trancheEffectifsEtablissement:("22")')
    expect(q).not.toContain('21*')
    expect(q).not.toContain('23:bad')
  })

  it('produit une query de longueur raisonnable pour 20 NAF (sous 8KB Solr)', () => {
    const naf20 = Array.from({ length: 20 }, (_, i) => `${String(i).padStart(4, '0')}Z`)
    const q = buildLuceneQuery(
      naf20,
      ['21', '22', '31', '32', '41', '42', '51', '52', '53'],
      ['00000', '99999'],
    )
    // Approx : 32 (etat) + 5 (AND) + 36 (cp) + 5 + ~70 (tranches) + 5 + ~200 (naf) ≈ 350.
    expect(q.length).toBeLessThan(500)
  })
})
