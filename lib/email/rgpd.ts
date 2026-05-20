// ============================================================
// RGPD — Mentions article 14 pour premier contact prospection
//
// Référentiel CNIL "prospection commerciale" 2020 §3.2 :
//   Quand les données prospect sont collectées indirectement
//   (Hunter, INPI, ADEME, Pappers, scraping LinkedIn), l'info-
//   rmation RGPD art. 14 doit être délivrée AU PLUS TARD lors
//   de la première communication.
//
// On injecte donc ce footer textuel dans le corps du PREMIER
// email envoyé à un prospect. Le timestamp est persisté dans
// prospects.first_contact_at (migration 022) pour preuve.
// ============================================================

/**
 * Le mot-clé `{{opt_out_link}}` est interpolé par appendRgpdFooter()
 * avec le lien HMAC généré via lib/auth/opt-out-token.
 */
export const ART14_FOOTER = `──────────
Conformément à l'article 14 du RGPD :
- Responsable du traitement : STROFE
- Finalité : prospection commerciale pour services de conseil bilan carbone (obligation BEGES Art. L. 229-25)
- Sources : Sirene INSEE, registre ADEME BEGES, données publiques
- Durée de conservation : 3 ans à compter du dernier échange
- Droits : accès, rectification, effacement, opposition (samir.anbri@strofe.fr)
- En savoir plus : https://decarbonleads.strofe.fr/legal/prospection
- Ne plus recevoir : {{opt_out_link}}`

/**
 * Ajoute le footer RGPD art. 14 à un corps d'email texte.
 * Insertion idempotente — si le marqueur est déjà présent, on ne duplique pas.
 *
 * @param body Corps de l'email (texte brut)
 * @param optOutLink URL HMAC d'opt-out 1-clic
 * @returns Corps augmenté du footer RGPD art. 14
 */
export function appendRgpdFooter(body: string, optOutLink: string): string {
  if (body.includes('Conformément à l\'article 14 du RGPD')) {
    // Déjà présent — éviter doublon (sécurité défensive même si la route
    // garantit normalement un seul appel)
    return body
  }
  const footer = ART14_FOOTER.replace('{{opt_out_link}}', optOutLink)
  return `${body.trimEnd()}\n\n${footer}`
}
