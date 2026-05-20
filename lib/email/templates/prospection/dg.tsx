// ============================================================
// TEMPLATE EMAIL — Persona DG / Présidence (GLN-020)
//
// Ordre obligatoire (.claude/rules/llm-prompts.md) :
//   1. Gains financiers concrets / accès marchés
//   2. Image de marque / vision long terme
//   3. Contrainte légale en dernier appui (art. L229-25 + loi Climat)
// ============================================================

import * as React from 'react'
import { ProspectionEmailLayout, type ProspectionEmailProps } from './_layout'

export const SUBJECT = 'Accès aux marchés publics et trajectoire carbone — {{raison_sociale}}'

export const BODY = `Bonjour {{prenom}},

Samir, consultant Bilan Carbone certifié ABC. Je travaille avec des dirigeants de {{secteur_libelle}} pour transformer la contrainte BEGES en levier commercial.

Trois enjeux pour {{raison_sociale}} sur les 18 prochains mois :
- Accès aux marchés publics : depuis la loi Climat & Résilience (août 2021, art. 35), les acheteurs publics doivent intégrer des considérations environnementales dans leurs critères d'attribution. Sans BEGES à jour, vous êtes mécaniquement écarté des appels d'offres > 100 K€.
- Subventions ADEME jusqu'à 70 % et accès aux prêts BPI bonifiés (Diag Décarbon'Action + Plan Climat Entreprise).
- Différenciation concurrentielle : sur un marché qui se polarise, l'entreprise avec une trajectoire 2030 chiffrée gagne les RFP face à des concurrents non préparés.

Au-delà de l'opportunité commerciale, c'est un signal de gouvernance fort vis-à-vis de vos partenaires bancaires, vos clients grands comptes et vos jeunes recrues — qui regardent ces critères en priorité.

L'article L. 229-25 prévoit aussi une amende jusqu'à 10 000 € par BEGES manquant (50 000 € en récidive), mais la vraie perte serait commerciale.

Disponible pour un échange court de 20 minutes la semaine prochaine. Quel créneau vous arrange ?`

export interface DgEmailProps extends Omit<ProspectionEmailProps, 'preview'> {}

export function DgEmail(props: DgEmailProps): React.ReactElement {
  return (
    <ProspectionEmailLayout
      {...props}
      preview="Accès marchés publics, subventions 70 %, trajectoire 2030 chiffrée."
    />
  )
}

export default DgEmail
