// ============================================================
// TESTS — lib/agent/decret-2022.ts (GLN-006)
//
// Vérifie la détection de conformité au Décret 2022-982 sur des
// payloads ADEME Data Fair plausibles. La structure exacte n'étant
// pas formellement documentée, les tests couvrent plusieurs synonymes
// de champs (scope 3 numérique, postes catégoriels, plan d'action /
// plan de transition / objectifs de réduction).
//
// Tristate :
//   - `null`  : non applicable (pas de bilan, bilan pré-2023, ou data
//               incomplète au point de ne pas pouvoir juger).
//   - `true`  : scope 3 ET plan d'action présents.
//   - `false` : bilan post-2023 mais l'un des deux manque.
// ============================================================

import { describe, expect, it } from 'vitest'
import { isDecret2022Compliant } from '../decret-2022'

describe('isDecret2022Compliant', () => {
  // --------------------------------------------------------------
  // CAS null (non applicable)
  // --------------------------------------------------------------

  it('retourne null si bilan_ges_data est null/undefined (pas de BEGES)', () => {
    expect(isDecret2022Compliant(null)).toBeNull()
    expect(isDecret2022Compliant(undefined)).toBeNull()
  })

  it('retourne null si bilan_ges_data est un objet vide', () => {
    expect(isDecret2022Compliant({})).toBeNull()
  })

  it('retourne null si bilan publié avant le 1er janvier 2023 (hors champ du décret)', () => {
    // BEGES 2022 — l'ancien régime ne demandait pas scope 3 + plan d'action.
    expect(
      isDecret2022Compliant({
        date_de_publication: '2022-06-15',
        emissions_scope_3: 1234,
        plan_action_transition: 'plan',
      }),
    ).toBeNull()
  })

  it('retourne null si BEGES post-2023 mais sans aucun champ exploitable', () => {
    // L'API ADEME peut ne pas exposer les champs pour ce bilan : on ne
    // stigmatise pas le prospect par défaut.
    expect(
      isDecret2022Compliant({
        date_de_publication: '2024-06-01',
        siren_principal: '542065479',
        raison_sociale: 'X',
        annee_de_reporting: 2023,
      }),
    ).toBeNull()
  })

  it('retourne null si date_de_publication absente / non parseable', () => {
    expect(
      isDecret2022Compliant({
        emissions_scope_3: 100,
        plan_action_transition: 'oui',
      }),
    ).toBeNull()
  })

  // --------------------------------------------------------------
  // CAS true (conforme)
  // --------------------------------------------------------------

  it('retourne true si BEGES post-2023 avec scope 3 numérique + plan d\'action', () => {
    expect(
      isDecret2022Compliant({
        date_de_publication: '2024-09-01',
        emissions_scope_3: 5432.1,
        plan_action_transition: 'Réduction 30% scope 1+2 d\'ici 2030',
      }),
    ).toBe(true)
  })

  it('retourne true avec synonymes plan d\'action (objectifs_reduction, plan_transition…)', () => {
    expect(
      isDecret2022Compliant({
        date_de_publication: '2024-01-15',
        emissions_scope_3: 100,
        objectifs_reduction: '-25% d\'ici 2027',
      }),
    ).toBe(true)
    expect(
      isDecret2022Compliant({
        date_de_publication: '2024-01-15',
        scope_3_emissions: 50,
        plan_de_transition: 'voir annexe',
      }),
    ).toBe(true)
  })

  it('retourne true avec scope 3 inféré depuis emissions_par_poste (catégorie 3)', () => {
    expect(
      isDecret2022Compliant({
        date_de_publication: '2023-12-01',
        emissions_par_poste: [
          { categorie: 1, libelle: 'Combustion', valeur: 1000 },
          { categorie: 3, libelle: 'Achats biens et services', valeur: 5000 },
        ],
        plan_action: 'défini',
      }),
    ).toBe(true)
  })

  // --------------------------------------------------------------
  // CAS false (non conforme — signal commercial fort)
  // --------------------------------------------------------------

  it('retourne false si BEGES post-2023 avec scope 3 mais SANS plan d\'action', () => {
    // L'API expose AU MOINS un des champs candidats : on peut conclure.
    expect(
      isDecret2022Compliant({
        date_de_publication: '2024-06-01',
        emissions_scope_3: 1234,
        plan_action_transition: null, // explicitement absent
      }),
    ).toBe(false)
  })

  it('retourne false si BEGES post-2023 avec plan d\'action mais SANS scope 3', () => {
    expect(
      isDecret2022Compliant({
        date_de_publication: '2024-06-01',
        emissions_scope_3: 0, // déclaré mais nul = non significatif
        plan_action_transition: 'Plan en cours d\'élaboration',
      }),
    ).toBe(false)
  })

  it('retourne false si scope 3 absent (clef présente mais 0) + plan vide', () => {
    expect(
      isDecret2022Compliant({
        date_de_publication: '2024-01-01',
        emissions_scope_3: 0,
        plan_action_transition: '',
      }),
    ).toBe(false)
  })

  // --------------------------------------------------------------
  // ROBUSTESSE
  // --------------------------------------------------------------

  it('accepte emissions_scope_3 sous forme de string numérique (format ADEME variable)', () => {
    expect(
      isDecret2022Compliant({
        date_de_publication: '2024-06-01',
        emissions_scope_3: '5432.1',
        plan_action: 'OK',
      }),
    ).toBe(true)
  })

  it('parse correctement une date publication au format complet ISO (avec heure)', () => {
    expect(
      isDecret2022Compliant({
        date_de_publication: '2024-09-01T14:30:00.000Z',
        emissions_scope_3: 100,
        plan_action_transition: 'défini',
      }),
    ).toBe(true)
  })

  it('rejette les payloads non-objet (string, array, number)', () => {
    expect(isDecret2022Compliant('plain string' as unknown as Record<string, unknown>)).toBeNull()
    expect(
      isDecret2022Compliant(
        [1, 2, 3] as unknown as Record<string, unknown>,
      ),
    ).toBeNull()
  })
})
