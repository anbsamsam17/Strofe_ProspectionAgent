// ============================================================
// TEMPLATE EMAIL — Persona DRH / Ressources Humaines (GLN-020)
//
// Ordre obligatoire (.claude/rules/llm-prompts.md) :
//   1. Gains financiers concrets (subventions, ROI engagement)
//   2. Image de marque (marque employeur, attractivité)
//   3. Contrainte légale en dernier appui
// ============================================================

import * as React from 'react'
import { ProspectionEmailLayout, type ProspectionEmailProps } from './_layout'

export const SUBJECT = 'Marque employeur et engagement collab — {{raison_sociale}}'

export const BODY = `Bonjour {{prenom}},

Samir, consultant Bilan Carbone certifié ABC. J'aide les équipes RH de {{secteur_libelle}} à transformer leur démarche carbone en levier marque employeur — au-delà de l'aspect réglementaire pur.

Trois bénéfices concrets pour {{raison_sociale}} :
- Subventions ADEME (Diag Décarbon'Action) jusqu'à 70 % du coût d'étude — le projet ne pèse pas sur le budget RH.
- ROI engagement mesurable : les entreprises qui embarquent leurs collaborateurs dans la démarche (ateliers Fresque du Climat, plan de mobilité, télétravail) constatent +12 à +18 points de eNPS dans les 12 mois post-bilan (source baromètre ADEME-Comité 21).
- Différenciation à l'embauche : 78 % des jeunes diplômés bac+5 placent l'engagement environnemental en top 3 des critères de choix d'employeur (Universum 2024). Sans démarche structurée, vos concurrents les captent.

Sur la dimension marque employeur, le plan de transition associé au BEGES devient un asset RH solide pour les communications carrières, les Glassdoor et les rapports d'engagement annuels.

À titre informatif, le BEGES de {{raison_sociale}} arrivera à échéance avant {{beges_expire_le}} (art. L. 229-25) — mais l'opportunité est plutôt sur la rétention et l'attractivité.

Je vous propose 20 minutes d'échange pour cadrer ce que ça peut donner concrètement chez vous.`

export interface DrhEmailProps extends Omit<ProspectionEmailProps, 'preview'> {}

export function DrhEmail(props: DrhEmailProps): React.ReactElement {
  return (
    <ProspectionEmailLayout
      {...props}
      preview="Marque employeur, +12-18 pts eNPS, attractivité jeunes diplômés."
    />
  )
}

export default DrhEmail
