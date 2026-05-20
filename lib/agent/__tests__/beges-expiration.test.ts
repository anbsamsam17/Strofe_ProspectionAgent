// ============================================================
// TESTS — lib/agent/beges-expiration.ts (GLN-080)
//
// Couvre 4 cas demandés explicitement :
//   - expiration dans 60j → true
//   - expiration dans 120j → false
//   - expirée hier → false
//   - pas de date publication → false
// + cas public (3 ans) vs privé (4 ans) pour valider le branchement.
// ============================================================

import { describe, expect, it } from 'vitest'
import { isBegesExpiringSoon } from '../beges-expiration'

// Date de référence stable pour tous les tests : 2026-05-20 (cf. session
// utilisateur). Permet de raisonner en dates absolues.
const NOW = new Date('2026-05-20T00:00:00Z')

/**
 * Fabrique une date publication telle que l'expiration tombe à `daysFromNow`.
 * - Privé : on recule de (4 ans - daysFromNow) depuis NOW.
 * - Public : on recule de (3 ans - daysFromNow) depuis NOW.
 */
function publicationFor(daysFromNow: number, entitePublique = false): string {
  const validiteAns = entitePublique ? 3 : 4
  // expirationDate = publication + validiteAns ans → publication = NOW + daysFromNow - validiteAns ans
  const targetExpiration = new Date(NOW)
  targetExpiration.setUTCDate(targetExpiration.getUTCDate() + daysFromNow)
  const publication = new Date(targetExpiration)
  publication.setUTCFullYear(publication.getUTCFullYear() - validiteAns)
  return publication.toISOString().substring(0, 10)
}

describe('isBegesExpiringSoon', () => {
  it('retourne true si expire dans 60 jours (fenêtre [0, 90j])', () => {
    expect(
      isBegesExpiringSoon(
        {
          beges_derniere_publication: publicationFor(60),
          entite_publique: false,
        },
        NOW,
      ),
    ).toBe(true)
  })

  it('retourne false si expire dans 120 jours (au-delà de la fenêtre 90j)', () => {
    expect(
      isBegesExpiringSoon(
        {
          beges_derniere_publication: publicationFor(120),
          entite_publique: false,
        },
        NOW,
      ),
    ).toBe(false)
  })

  it('retourne false si déjà expiré (la veille)', () => {
    expect(
      isBegesExpiringSoon(
        {
          beges_derniere_publication: publicationFor(-1),
          entite_publique: false,
        },
        NOW,
      ),
    ).toBe(false)
  })

  it('retourne false si pas de date de publication', () => {
    expect(
      isBegesExpiringSoon(
        { beges_derniere_publication: null, entite_publique: false },
        NOW,
      ),
    ).toBe(false)
  })

  // --------------------------------------------------------------
  // Validation du branchement public (3 ans) vs privé (4 ans).
  // --------------------------------------------------------------

  it('utilise la validité 3 ans pour les entités publiques', () => {
    // Publication il y a 3 ans - 30 jours → expire dans 30j (dans la fenêtre).
    expect(
      isBegesExpiringSoon(
        {
          beges_derniere_publication: publicationFor(30, true),
          entite_publique: true,
        },
        NOW,
      ),
    ).toBe(true)
  })

  it('un BEGES public publié il y a 3 ans pile est tout juste expiré → false', () => {
    // Publication il y a exactement 3 ans → expirée la veille = false.
    expect(
      isBegesExpiringSoon(
        {
          beges_derniere_publication: publicationFor(-1, true),
          entite_publique: true,
        },
        NOW,
      ),
    ).toBe(false)
  })

  it('retourne false sur date de publication invalide (format cassé)', () => {
    expect(
      isBegesExpiringSoon(
        {
          beges_derniere_publication: 'pas-une-date',
          entite_publique: false,
        },
        NOW,
      ),
    ).toBe(false)
  })

  it('expire exactement le dernier jour de la fenêtre (90 jours) → true', () => {
    expect(
      isBegesExpiringSoon(
        {
          beges_derniere_publication: publicationFor(90),
          entite_publique: false,
        },
        NOW,
      ),
    ).toBe(true)
  })
})
