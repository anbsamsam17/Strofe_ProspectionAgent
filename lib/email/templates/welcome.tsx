// ============================================================
// TEMPLATE EMAIL — Bienvenue sur DecarbonLeads
// Compatible : Gmail, Outlook, Apple Mail (inline styles via React Email)
// ============================================================

import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'
import * as React from 'react'

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export interface WelcomeEmailProps {
  userName: string
}

// ------------------------------------------------------------
// Données statiques
// ------------------------------------------------------------

const STEPS = [
  {
    number: '1',
    icon: '🤖',
    title: "L'agent source",
    description:
      "Chaque nuit, l'agent interroge la base Sirene (INSEE) et le registre ADEME pour identifier les entreprises ayant une obligation BEGES ou des signaux de décarbonation.",
  },
  {
    number: '2',
    icon: '🧠',
    title: 'Il score sur 3 piliers',
    description:
      "Chaque prospect reçoit un score 0-100 sur taille de l'entreprise, statut BEGES (publié, valide, échu), qualité du contact. Pondérations modifiables.",
  },
  {
    number: '3',
    icon: '📞',
    title: 'Vous pilotez le pipeline',
    description:
      "Pipeline Kanban 8 statuts, multi-contacts par prospect, journal d'échanges horodaté. L'agent prépare le terrain, vous appelez.",
  },
]

const TIPS = [
  {
    icon: '🎯',
    title: 'Votre offre',
    description:
      'Décrivez votre prestation (bilan carbone, ACV, plan de décarbonation…) pour que les pitchs générés soient adaptés à votre positionnement.',
  },
  {
    icon: '🏭',
    title: 'Vos secteurs cibles',
    description:
      "Selectionnez les codes NAF de vos secteurs preferes. L'agent priorisera les entreprises de ces secteurs dans la selection quotidienne.",
  },
  {
    icon: '📍',
    title: 'Votre zone géographique',
    description:
      'Renseignez votre ville ou vos codes postaux cibles pour limiter les déplacements et concentrer la prospection localement.',
  },
]

// ------------------------------------------------------------
// Composant principal
// ------------------------------------------------------------

export function WelcomeEmail({ userName }: WelcomeEmailProps) {
  const settingsUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://decarbonleads.strofe.fr'}/dashboard/settings`

  return (
    <Html lang="fr" dir="ltr">
      <Head />
      <Preview>
        Bienvenue sur DecarbonLeads — configurez votre agent en 3 minutes
      </Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          {/* ── HEADER ── */}
          <Section style={styles.header}>
            <Text style={styles.logoText}>DecarbonLeads</Text>
            <Text style={styles.logoSubtitle}>by STROFE</Text>
          </Section>

          {/* ── HERO ── */}
          <Section style={styles.hero}>
            <Text style={styles.heroEmoji}>🌱</Text>
            <Heading style={styles.heroTitle}>
              Bienvenue sur DecarbonLeads, {userName} !
            </Heading>
            <Text style={styles.heroSubtitle}>
              Votre agent de prospection bilan carbone est prêt. Quelques minutes de
              configuration suffisent pour recevoir vos 15 premiers appels qualifiés dès demain matin.
            </Text>
          </Section>

          <Hr style={styles.divider} />

          {/* ── COMMENT ÇA MARCHE ── */}
          <Section style={styles.section}>
            <Heading style={styles.sectionTitle}>Comment ça marche</Heading>

            {STEPS.map((step) => (
              <Row key={step.number} style={styles.stepRow}>
                <Column style={styles.stepNumberCol}>
                  <Text style={styles.stepNumber}>{step.number}</Text>
                </Column>
                <Column style={styles.stepContent}>
                  <Text style={styles.stepTitle}>
                    {step.icon} {step.title}
                  </Text>
                  <Text style={styles.stepDescription}>{step.description}</Text>
                </Column>
              </Row>
            ))}
          </Section>

          <Hr style={styles.divider} />

          {/* ── CTA ── */}
          <Section style={styles.ctaSection}>
            <Heading style={styles.ctaTitle}>Prêt à démarrer ?</Heading>
            <Text style={styles.ctaSubtitle}>
              Configurez votre agent en 3 minutes. Les premiers prospects arrivent dès cette nuit.
            </Text>
            <Button href={settingsUrl} style={styles.ctaButton}>
              Configurer mon agent →
            </Button>
          </Section>

          <Hr style={styles.divider} />

          {/* ── TIPS DE DÉMARRAGE ── */}
          <Section style={styles.section}>
            <Heading style={styles.sectionTitle}>Ce qu'il faut renseigner</Heading>
            <Text style={styles.tipsIntro}>
              3 informations clés pour que l'agent soit opérationnel :
            </Text>

            {TIPS.map((tip, index) => (
              <Section key={index} style={styles.tipCard}>
                <Row>
                  <Column style={styles.tipIconCol}>
                    <Text style={styles.tipIcon}>{tip.icon}</Text>
                  </Column>
                  <Column style={styles.tipContent}>
                    <Text style={styles.tipTitle}>{tip.title}</Text>
                    <Text style={styles.tipDescription}>{tip.description}</Text>
                  </Column>
                </Row>
              </Section>
            ))}
          </Section>

          <Hr style={styles.divider} />

          {/* ── BLOCK RASSURANT ── */}
          <Section style={styles.reassureSection}>
            <Text style={styles.reassureText}>
              Vous avez des questions ? Répondez directement à cet email — notre
              équipe est là pour vous accompagner dans vos premiers appels.
            </Text>
          </Section>

          <Hr style={styles.divider} />

          {/* ── FOOTER ── */}
          <Section style={styles.footer}>
            <Text style={styles.footerBrand}>DecarbonLeads by STROFE</Text>
            <Text style={styles.footerText}>
              Vous recevez cet email car vous venez de créer un compte DecarbonLeads.{' '}
              <Link href={`${settingsUrl}#notifications`} style={styles.footerLink}>
                Gérer mes notifications
              </Link>
            </Text>
            <Text style={styles.footerAddress}>
              STROFE — Conseil Bilan Carbone & Décarbonation
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

// ------------------------------------------------------------
// Styles (inline — compatibilité email clients)
// ------------------------------------------------------------

const styles = {
  body: {
    backgroundColor: '#f9fafb',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    margin: '0',
    padding: '0',
  },
  container: {
    backgroundColor: '#ffffff',
    margin: '0 auto',
    maxWidth: '600px',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  // Header
  header: {
    backgroundColor: '#16a34a',
    padding: '20px 32px',
    textAlign: 'center' as const,
  },
  logoText: {
    color: '#ffffff',
    fontSize: '22px',
    fontWeight: '700',
    margin: '0',
    lineHeight: '1.2',
  },
  logoSubtitle: {
    color: '#bbf7d0',
    fontSize: '12px',
    margin: '4px 0 0 0',
  },
  // Hero
  hero: {
    padding: '40px 32px 28px',
    textAlign: 'center' as const,
  },
  heroEmoji: {
    fontSize: '48px',
    margin: '0 0 12px 0',
    lineHeight: '1',
  },
  heroTitle: {
    color: '#111827',
    fontSize: '24px',
    fontWeight: '700',
    margin: '0 0 14px 0',
    lineHeight: '1.3',
  },
  heroSubtitle: {
    color: '#6b7280',
    fontSize: '15px',
    lineHeight: '1.7',
    margin: '0',
  },
  // Section
  section: {
    padding: '24px 32px',
  },
  sectionTitle: {
    color: '#374151',
    fontSize: '14px',
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    margin: '0 0 20px 0',
  },
  divider: {
    borderColor: '#e5e7eb',
    margin: '0',
  },
  // Steps
  stepRow: {
    marginBottom: '20px',
  },
  stepNumberCol: {
    width: '40px',
    verticalAlign: 'top',
  },
  stepNumber: {
    backgroundColor: '#16a34a',
    borderRadius: '50%',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '700',
    height: '32px',
    lineHeight: '32px',
    margin: '0',
    textAlign: 'center' as const,
    width: '32px',
  },
  stepContent: {
    paddingLeft: '14px',
    verticalAlign: 'top',
  },
  stepTitle: {
    color: '#111827',
    fontSize: '15px',
    fontWeight: '600',
    margin: '0 0 4px 0',
  },
  stepDescription: {
    color: '#6b7280',
    fontSize: '13px',
    lineHeight: '1.6',
    margin: '0',
  },
  // CTA
  ctaSection: {
    padding: '28px 32px',
    textAlign: 'center' as const,
    backgroundColor: '#f0fdf4',
  },
  ctaTitle: {
    color: '#111827',
    fontSize: '20px',
    fontWeight: '700',
    margin: '0 0 8px 0',
  },
  ctaSubtitle: {
    color: '#6b7280',
    fontSize: '14px',
    margin: '0 0 20px 0',
    lineHeight: '1.6',
  },
  ctaButton: {
    backgroundColor: '#16a34a',
    borderRadius: '6px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '15px',
    fontWeight: '600',
    padding: '14px 32px',
    textDecoration: 'none',
  },
  // Tips
  tipsIntro: {
    color: '#6b7280',
    fontSize: '13px',
    margin: '0 0 16px 0',
  },
  tipCard: {
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    padding: '14px 16px',
    marginBottom: '10px',
  },
  tipIconCol: {
    width: '40px',
    verticalAlign: 'top',
  },
  tipIcon: {
    fontSize: '22px',
    margin: '0',
  },
  tipContent: {
    paddingLeft: '12px',
    verticalAlign: 'top',
  },
  tipTitle: {
    color: '#374151',
    fontSize: '14px',
    fontWeight: '600',
    margin: '0 0 2px 0',
  },
  tipDescription: {
    color: '#6b7280',
    fontSize: '12px',
    lineHeight: '1.5',
    margin: '0',
  },
  // Reassure block
  reassureSection: {
    backgroundColor: '#fffbeb',
    padding: '20px 32px',
    textAlign: 'center' as const,
  },
  reassureText: {
    color: '#92400e',
    fontSize: '13px',
    lineHeight: '1.6',
    margin: '0',
  },
  // Footer
  footer: {
    padding: '20px 32px',
    textAlign: 'center' as const,
    backgroundColor: '#f9fafb',
  },
  footerBrand: {
    color: '#374151',
    fontSize: '13px',
    fontWeight: '600',
    margin: '0 0 8px 0',
  },
  footerText: {
    color: '#9ca3af',
    fontSize: '12px',
    lineHeight: '1.6',
    margin: '0 0 6px 0',
  },
  footerLink: {
    color: '#6b7280',
    textDecoration: 'underline',
  },
  footerAddress: {
    color: '#d1d5db',
    fontSize: '11px',
    margin: '0',
  },
} as const

export default WelcomeEmail
