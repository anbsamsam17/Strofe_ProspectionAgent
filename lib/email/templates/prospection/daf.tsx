// ============================================================
// TEMPLATE EMAIL — Persona DAF / Direction financière (GLN-020)
//
// Ordre obligatoire (.claude/rules/llm-prompts.md) :
//   1. Gains financiers concrets (ROI, subventions, prêts)
//   2. Image de marque (qualification fournisseur grands comptes)
//   3. Contrainte légale en dernier appui (art. L229-25)
// ============================================================

import * as React from 'react'
import { ProspectionEmailLayout, type ProspectionEmailProps } from './_layout'

/**
 * Sujet par défaut — éditable dans le composer.
 * Variables : {{raison_sociale}}
 */
export const SUBJECT = 'Subventions ADEME et économies opérationnelles — {{raison_sociale}}'

/**
 * Corps par défaut — éditable dans le composer.
 * Variables : {{prenom}}, {{raison_sociale}}, {{secteur_libelle}}, {{beges_expire_le}}, {{calendly_url}}
 */
export const BODY = `Bonjour {{prenom}},

Je m'appelle Samir, je conseille des entreprises de {{secteur_libelle}} sur leur bilan carbone et la décarbonation. Je me permets de vous écrire car {{raison_sociale}} doit publier son BEGES avant {{beges_expire_le}}.

Trois leviers financiers concrets que nous activons systématiquement :
- Subventions ADEME jusqu'à 70 % du coût de la prestation (Diag Décarbon'Action).
- Économies d'exploitation 10 à 30 % sur les postes énergétiques identifiés dans le bilan.
- Accès aux prêts BPI bonifiés Climat et aux financements verts conditionnés à la trajectoire SBTi.

Au-delà du chiffre, le BEGES est devenu un critère de qualification fournisseur chez la plupart des grands donneurs d'ordre publics et privés — un dossier solide ouvre des marchés que les concurrents non conformes ne peuvent plus prendre.

Pour mémoire, l'article L. 229-25 du Code de l'environnement prévoit une amende jusqu'à 10 000 € par BEGES manquant (50 000 € en cas de récidive), mais l'enjeu commercial dépasse largement la sanction.

Disponible pour un échange de 15 minutes la semaine prochaine si le sujet vous intéresse.`

export interface DafEmailProps extends Omit<ProspectionEmailProps, 'preview'> {}

export function DafEmail(props: DafEmailProps): React.ReactElement {
  return (
    <ProspectionEmailLayout
      {...props}
      preview="Subventions ADEME 70 %, économies 10-30 %, accès marchés publics."
    />
  )
}

export default DafEmail
