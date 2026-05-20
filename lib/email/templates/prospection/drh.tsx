// ============================================================
// TEMPLATE EMAIL — Persona DRH / Direction des ressources humaines (GLN-020)
//
// Refonte 2026-05-20 : ton sobre et factuel (cf. exemple Transports
// Méridien). Angle DRH = marque employeur + engagement collaborateurs
// (attractivité, jeunes diplômés, RSE comme axe de fidélisation).
// ============================================================

import * as React from 'react'
import { ProspectionEmailLayout, type ProspectionEmailProps } from './_layout'

export const SUBJECT = 'BEGES réglementaire — mise à jour {{raison_sociale}}'

export const BODY = `Bonjour {{prenom}} {{nom}},

Je vous contacte au sujet du Bilan GES réglementaire (bilan des émissions de gaz à effet de serre) de {{raison_sociale}}, dont le dernier bilan publié sur le registre de l'ADEME porte sur l'année de reporting {{beges_annee_reporting}}.

L'échéance de mise à jour étant dépassée, vous êtes sans doute déjà sur le sujet en lien avec la direction RSE. Dans {{secteur_libelle}}, la démarche mobilise plusieurs équipes et a souvent un volet RH visible — sensibilisation, formation, engagement collaborateurs.

Au-delà de l'obligation, le bilan carbone est devenu un signal fort sur la marque employeur : attractivité des candidats — en particulier jeunes diplômés sensibles aux enjeux climatiques — et engagement des équipes en place.

Nous sommes à disposition pour réaliser et publier votre BEGES afin de répondre rapidement aux obligations de l'article L. 229-25 du Code de l'environnement.

Si un échange peut vous être utile, je reste disponible.

Je vous remercie de votre attention.`

export interface DrhEmailProps extends Omit<ProspectionEmailProps, 'preview'> {}

export function DrhEmail(props: DrhEmailProps): React.ReactElement {
  return (
    <ProspectionEmailLayout
      {...props}
      preview="BEGES, marque employeur et engagement collaborateurs."
    />
  )
}

export default DrhEmail
