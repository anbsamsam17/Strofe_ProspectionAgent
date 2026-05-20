// ============================================================
// TEMPLATE EMAIL — Persona RSE / Direction Développement Durable (GLN-020)
//
// Ordre obligatoire (.claude/rules/llm-prompts.md) :
//   1. Gains financiers concrets
//   2. Image de marque (engagement, méthode)
//   3. Contrainte légale en dernier appui
// ============================================================

import * as React from 'react'
import { ProspectionEmailLayout, type ProspectionEmailProps } from './_layout'

export const SUBJECT = 'Bilan Carbone ABC v8 — accompagnement {{raison_sociale}}'

export const BODY = `Bonjour {{prenom}},

Je suis Samir, consultant Bilan Carbone certifié ABC. Je travaille avec des équipes RSE de {{secteur_libelle}} sur la mesure et la trajectoire de réduction des émissions.

Trois bénéfices concrets sur votre prochain exercice :
- Subventions ADEME (Diag Décarbon'Action) couvrant jusqu'à 70 % du coût de l'étude.
- ROI rapide via les "quick wins" identifiés en scope 1 et 2 (achat énergie, flotte, déplacements).
- Trajectoire SBTi alignée 1,5 °C exploitable pour les rapports CSRD et les financements verts.

Sur la méthode, je couvre les scopes 1, 2 et 3 selon la Méthode Bilan Carbone v8 de l'ABC, avec un plan de transition conforme au décret 2022-982 (publication obligatoire depuis 2023). C'est ce qui fait la différence sur les appels d'offres publics et les notations extra-financières (EcoVadis, CDP).

À titre d'information, le BEGES de {{raison_sociale}} devra être renouvelé avant {{beges_expire_le}} pour rester valide au sens de l'article L. 229-25 — mais la vraie urgence est plutôt commerciale.

Je vous propose 20 minutes d'échange pour cadrer le périmètre. Disponible la semaine prochaine.`

export interface RseEmailProps extends Omit<ProspectionEmailProps, 'preview'> {}

export function RseEmail(props: RseEmailProps): React.ReactElement {
  return (
    <ProspectionEmailLayout
      {...props}
      preview="Bilan Carbone ABC v8, scopes 1/2/3, trajectoire SBTi & CSRD."
    />
  )
}

export default RseEmail
