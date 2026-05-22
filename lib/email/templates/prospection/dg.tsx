// ============================================================
// TEMPLATE EMAIL — Persona DG / Direction générale (GLN-020)
//
// Refonte 2026-05-20 : ton sobre et factuel (cf. exemple Transports
// Méridien). Angle DG = stratégie + accès aux marchés (publics et
// privés) avec critères carbone.
// ============================================================

import * as React from 'react'
import { ProspectionEmailLayout, type ProspectionEmailProps } from './_layout'

export const SUBJECT = 'BEGES réglementaire — mise à jour {{raison_sociale}}'

export const BODY = `Bonjour {{prenom}} {{nom}},

Je vous contacte au sujet du Bilan GES réglementaire (bilan des émissions de gaz à effet de serre) de {{raison_sociale}}, dont le dernier bilan publié sur le registre de l'ADEME porte sur l'année de reporting {{beges_annee_reporting}}.

L'échéance de mise à jour étant dépassée, vous êtes sans doute déjà sur le sujet. Dans {{secteur_libelle}}, l'exercice est exigeant : collecte des données opérationnelles, périmètre des filiales, scope 3 fournisseurs — l'enjeu dépasse souvent la seule direction RSE.

Au-delà de l'obligation, un BEGES à jour devient un prérequis dans plusieurs appels d'offres publics (Loi Climat 2021, art. 35) et chez les grands donneurs d'ordre privés. Son absence fragilise progressivement l'accès aux marchés et l'image de l'entreprise sur sa trajectoire carbone.

Nous sommes à disposition pour réaliser et publier votre BEGES afin de répondre rapidement aux obligations de l'article L. 229-25 du Code de l'environnement.

Si un échange peut vous être utile, je reste disponible.

Je vous remercie de votre attention.`

export interface DgEmailProps extends Omit<ProspectionEmailProps, 'preview'> {}

export function DgEmail(props: DgEmailProps): React.ReactElement {
  return (
    <ProspectionEmailLayout
      {...props}
      preview="BEGES, accès aux marchés et trajectoire carbone."
    />
  )
}

export default DgEmail
