// ============================================================
// REGISTRY DES TEMPLATES PROSPECTION (GLN-020)
//
// Chaque template exporte un SUBJECT et un BODY par défaut (avec
// placeholders {{prenom}}, {{raison_sociale}}, etc.) + un composant
// React Email pour le rendu HTML final.
// ============================================================

import * as DafTemplate from './daf'
import * as RseTemplate from './rse'
import * as DgTemplate from './dg'
import * as DrhTemplate from './drh'
import type { EmailPersona } from '../../detect-persona'
import type { ProspectionEmailProps } from './_layout'
import type * as React from 'react'

export interface ProspectionTemplate {
  /** Sujet par défaut, avec placeholders à interpoler. */
  subject: string
  /** Corps texte par défaut, avec placeholders à interpoler. */
  body: string
  /** Composant React Email pour le rendu HTML final. */
  Component: (props: Omit<ProspectionEmailProps, 'preview'>) => React.ReactElement
}

export const TEMPLATES: Record<EmailPersona, ProspectionTemplate> = {
  daf: {
    subject: DafTemplate.SUBJECT,
    body: DafTemplate.BODY,
    Component: DafTemplate.DafEmail,
  },
  rse: {
    subject: RseTemplate.SUBJECT,
    body: RseTemplate.BODY,
    Component: RseTemplate.RseEmail,
  },
  dg: {
    subject: DgTemplate.SUBJECT,
    body: DgTemplate.BODY,
    Component: DgTemplate.DgEmail,
  },
  drh: {
    subject: DrhTemplate.SUBJECT,
    body: DrhTemplate.BODY,
    Component: DrhTemplate.DrhEmail,
  },
}

export type { ProspectionEmailProps }
