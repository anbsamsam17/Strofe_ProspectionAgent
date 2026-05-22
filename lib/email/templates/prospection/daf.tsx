// ============================================================
// TEMPLATE EMAIL — Persona DAF / Direction financière (GLN-020)
//
// Refonte 2026-05-20 : ton sobre et factuel (cf. exemple Transports
// Méridien donné par le user). Angle DAF = exposition financière
// (amende + image vis-à-vis financeurs et donneurs d'ordre).
// ============================================================

import * as React from 'react'
import { ProspectionEmailLayout, type ProspectionEmailProps } from './_layout'

/**
 * Sujet par défaut — éditable dans le composer.
 * Variables : {{raison_sociale}}
 */
export const SUBJECT = 'BEGES réglementaire — mise à jour {{raison_sociale}}'

/**
 * Corps par défaut — éditable dans le composer.
 * Variables : {{prenom}}, {{nom}}, {{raison_sociale}}, {{secteur_libelle}},
 *             {{beges_annee_reporting}}, {{beges_expire_le}}, {{calendly_url}}
 */
export const BODY = `Bonjour {{prenom}} {{nom}},

Je vous contacte au sujet du Bilan GES réglementaire (bilan des émissions de gaz à effet de serre) de {{raison_sociale}}, dont le dernier bilan publié sur le registre de l'ADEME porte sur l'année de reporting {{beges_annee_reporting}}.

L'échéance de mise à jour étant dépassée, vous êtes sans doute déjà sur le sujet. Dans {{secteur_libelle}}, l'exercice est exigeant : la collecte des données carburant, énergie et scope 3 mobilise plusieurs services et peut s'avérer chronophage en interne.

Au-delà de l'obligation, l'absence de bilan à jour expose l'entreprise à une amende (jusqu'à 10 000 € par bilan manquant, 50 000 € en récidive) et fragilise son image vis-à-vis des donneurs d'ordre, financeurs et acheteurs publics.

Nous sommes à disposition pour réaliser et publier votre BEGES afin de répondre rapidement aux obligations de l'article L. 229-25 du Code de l'environnement.

Si un échange peut vous être utile, je reste disponible.

Je vous remercie de votre attention.`

export interface DafEmailProps extends Omit<ProspectionEmailProps, 'preview'> {}

export function DafEmail(props: DafEmailProps): React.ReactElement {
  return (
    <ProspectionEmailLayout
      {...props}
      preview="Bilan GES réglementaire — mise à jour ADEME."
    />
  )
}

export default DafEmail
