// ============================================================
// LAYOUT EMAIL PROSPECTION — wrapper React Email partagé
//
// Sert de base aux 4 templates DAF / RSE / DG / DRH (GLN-020).
// Garde l'ordre obligatoire de prospection : gains → image → légal.
// Pas de PII en dur — toutes les variables passées en props.
// ============================================================

import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import * as React from 'react'

export interface ProspectionEmailProps {
  /** Corps de l'email — éditable par l'utilisateur dans le composer. */
  body: string
  /** Texte de prévisualisation (apparait dans l'inbox sous le sujet). */
  preview: string
  /** URL de prise de rendez-vous (Calendly/Cal.com) — optionnel. */
  calendlyUrl?: string
  /** Bloc RGPD art. 14 — uniquement pour 1er contact (GLN-003). */
  rgpdFooter?: string
  /** Nom de l'expéditeur (consultant) — affiché dans la signature. */
  senderName?: string
}

/**
 * Layout partagé par toutes les templates persona prospection.
 * Le `body` est rendu en respectant les sauts de ligne (\n → <br />).
 */
export function ProspectionEmailLayout({
  body,
  preview,
  calendlyUrl,
  rgpdFooter,
  senderName,
}: ProspectionEmailProps) {
  return (
    <Html lang="fr" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.contentSection}>
            {body.split('\n').map((line, i) => (
              <Text key={i} style={styles.bodyLine}>
                {line || ' ' /* nbsp pour préserver lignes vides */}
              </Text>
            ))}
          </Section>

          {calendlyUrl && (
            <Section style={styles.ctaSection}>
              <Link href={calendlyUrl} style={styles.ctaButton}>
                Choisir un créneau
              </Link>
            </Section>
          )}

          {senderName && (
            <Section style={styles.signatureSection}>
              <Text style={styles.signatureName}>{senderName}</Text>
              <Text style={styles.signatureSubtitle}>
                Consultant Bilan Carbone — STROFE
              </Text>
            </Section>
          )}

          {rgpdFooter && (
            <>
              <Hr style={styles.divider} />
              <Section style={styles.footerSection}>
                {rgpdFooter.split('\n').map((line, i) => (
                  <Text key={i} style={styles.footerLine}>
                    {line || ' '}
                  </Text>
                ))}
              </Section>
            </>
          )}
        </Container>
      </Body>
    </Html>
  )
}

const styles = {
  body: {
    backgroundColor: '#ffffff',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    margin: '0',
    padding: '0',
    color: '#111827',
  },
  container: {
    margin: '0 auto',
    maxWidth: '640px',
    padding: '24px',
  },
  contentSection: {
    padding: '0',
  },
  bodyLine: {
    color: '#111827',
    fontSize: '15px',
    lineHeight: '1.7',
    margin: '0 0 4px 0',
  },
  ctaSection: {
    padding: '20px 0',
    textAlign: 'center' as const,
  },
  ctaButton: {
    backgroundColor: '#16a34a',
    borderRadius: '8px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '15px',
    fontWeight: '600',
    padding: '12px 28px',
    textDecoration: 'none',
  },
  signatureSection: {
    padding: '12px 0 8px',
  },
  signatureName: {
    color: '#111827',
    fontSize: '14px',
    fontWeight: '600',
    margin: '0',
  },
  signatureSubtitle: {
    color: '#6b7280',
    fontSize: '12px',
    margin: '2px 0 0 0',
  },
  divider: {
    borderColor: '#e5e7eb',
    margin: '24px 0 16px',
  },
  footerSection: {
    padding: '0',
  },
  footerLine: {
    color: '#9ca3af',
    fontSize: '11px',
    lineHeight: '1.5',
    margin: '0',
  },
} as const
