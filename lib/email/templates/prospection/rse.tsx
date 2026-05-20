// ============================================================
// TEMPLATE EMAIL — Persona RSE / Direction Développement Durable (GLN-020)
//
// Refonte 2026-05-20 : ton sobre et factuel (cf. exemple Transports
// Méridien). Angle RSE = trajectoire carbone, périmètre scope 1/2/3,
// alignement attentes clients / fonds ISR.
// ============================================================

import * as React from 'react'
import { ProspectionEmailLayout, type ProspectionEmailProps } from './_layout'

export const SUBJECT = 'BEGES réglementaire — mise à jour {{raison_sociale}}'

export const BODY = `Bonjour {{prenom}} {{nom}},

Je vous contacte au sujet du Bilan GES réglementaire (bilan des émissions de gaz à effet de serre) de {{raison_sociale}}, dont le dernier bilan publié sur le registre de l'ADEME porte sur l'année de reporting {{beges_annee_reporting}}.

L'échéance de mise à jour étant dépassée, vous êtes sans doute déjà sur le sujet. Dans {{secteur_libelle}}, la mise à jour est exigeante : couverture du scope 3 demandée par le Décret 2022-982, périmètre organisationnel cohérent, plan d'action chiffré — la collecte et la consolidation des données mobilisent plusieurs interlocuteurs.

Au-delà de l'obligation, la non-publication freine la construction d'une trajectoire carbone crédible et complique l'alignement avec les attentes croissantes du marché — clients grands comptes (CSRD), fonds ISR, partenaires fournisseurs.

Nous sommes à disposition pour réaliser et publier votre BEGES afin de répondre rapidement aux obligations de l'article L. 229-25 du Code de l'environnement.

Si un échange peut vous être utile, je reste disponible.

Je vous remercie de votre attention.`

export interface RseEmailProps extends Omit<ProspectionEmailProps, 'preview'> {}

export function RseEmail(props: RseEmailProps): React.ReactElement {
  return (
    <ProspectionEmailLayout
      {...props}
      preview="BEGES, scope 3 et trajectoire carbone."
    />
  )
}

export default RseEmail
