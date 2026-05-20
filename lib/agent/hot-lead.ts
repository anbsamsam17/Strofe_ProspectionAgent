// ============================================================
// HOT LEAD — Score composite (GLN-081)
//
// Pendant TypeScript de la colonne calculée `prospects.is_hot_lead`
// (migration 024). Source de vérité partagée entre DB (GENERATED
// ALWAYS) et UI client.
//
// Formule :
//   is_hot_lead = (
//     obligation_beges = TRUE
//     AND (NOT beges_publie OR NOT beges_valide OR beges_decret_2022_compliant = FALSE)
//     AND contact_email IS NOT NULL
//     AND effectif_min >= 250
//   )
//
// Notes :
//   - `beges_decret_2022_compliant` est tristate. Seule la valeur FALSE
//     compte comme "non conforme" (NULL = non applicable, cf. GLN-006).
//   - Le seuil 250 sal. est aligné sur le seuil DOM-TOM L229-25 (GLN-004)
//     ET correspond à la cible commerciale Glan / CSRD vague 2.
// ============================================================

/**
 * Effectif minimum pour qu'un prospect soit éligible "Hot lead".
 * Aligné sur le seuil DOM-TOM L229-25 + CSRD vague 2 (250-499 sal.).
 */
const HOT_LEAD_EFFECTIF_MIN = 250

/**
 * Type d'entrée minimal pour le helper.
 */
interface HotLeadInput {
  obligation_beges: boolean
  beges_publie: boolean
  beges_valide?: boolean | null
  beges_decret_2022_compliant?: boolean | null
  contact_email?: string | null
  effectif_min?: number | null
}

/**
 * Retourne `true` si le prospect remplit tous les critères Hot lead :
 *   - Soumis à l'obligation BEGES (Art. L229-25).
 *   - BEGES manquant OU expiré OU non conforme Décret 2022.
 *   - Email de contact disponible.
 *   - Effectif minimum >= 250 salariés.
 *
 * Doit rester strictement équivalent à la GENERATED column DB.
 */
export function isHotLead(p: HotLeadInput): boolean {
  if (p.obligation_beges !== true) return false

  // Au moins un signal "BEGES défaillant" doit être présent.
  const begesNotPublished = p.beges_publie !== true
  const begesNotValid = p.beges_valide === false
  const begesNotCompliant = p.beges_decret_2022_compliant === false
  if (!begesNotPublished && !begesNotValid && !begesNotCompliant) return false

  if (p.contact_email == null || p.contact_email.length === 0) return false
  if ((p.effectif_min ?? 0) < HOT_LEAD_EFFECTIF_MIN) return false

  return true
}
