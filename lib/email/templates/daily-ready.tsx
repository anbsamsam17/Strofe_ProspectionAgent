// ============================================================
// TEMPLATE EMAIL — Liste quotidienne prête
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

interface TopProspect {
  raison_sociale: string
  secteur_libelle: string
  priorite: string
  score: number
}

export interface DailyReadyEmailProps {
  userName: string
  date: string
  callsCount: number
  topProspects: TopProspect[]
  appUrl: string
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

const PRIORITY_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  HAUTE: { label: 'HAUTE', bg: '#fee2e2', color: '#b91c1c' },
  haute: { label: 'HAUTE', bg: '#fee2e2', color: '#b91c1c' },
  NORMALE: { label: 'NORMALE', bg: '#fff7ed', color: '#c2410c' },
  normale: { label: 'NORMALE', bg: '#fff7ed', color: '#c2410c' },
  BASSE: { label: 'BASSE', bg: '#f3f4f6', color: '#6b7280' },
  basse: { label: 'BASSE', bg: '#f3f4f6', color: '#6b7280' },
}

function getPriorityConfig(priorite: string) {
  return (
    PRIORITY_CONFIG[priorite] ?? { label: priorite.toUpperCase(), bg: '#f3f4f6', color: '#6b7280' }
  )
}

// ------------------------------------------------------------
// Composant principal
// ------------------------------------------------------------

export function DailyReadyEmail({
  userName,
  date,
  callsCount,
  topProspects,
  appUrl,
}: DailyReadyEmailProps) {
  const previewText = `Vos ${callsCount} appels du ${date} sont prêts — DecarbonLeads`

  return (
    <Html lang="fr" dir="ltr">
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          {/* ── HEADER ── */}
          <Section style={styles.header}>
            <Row>
              <Column>
                <Text style={styles.logoText}>DecarbonLeads</Text>
                <Text style={styles.logoSubtitle}>by STROFE</Text>
              </Column>
              <Column align="right">
                <Text style={styles.headerDate}>{date}</Text>
              </Column>
            </Row>
          </Section>

          {/* ── HERO ── */}
          <Section style={styles.hero}>
            <Text style={styles.heroEmoji}>✅</Text>
            <Heading style={styles.heroTitle}>
              Vos {callsCount} appels sont prêts
            </Heading>
            <Text style={styles.heroSubtitle}>
              Bonjour {userName}, votre agent a travaillé cette nuit.
              Voici les meilleures opportunités sélectionnées pour vous aujourd'hui.
            </Text>
          </Section>

          <Hr style={styles.divider} />

          {/* ── APERÇU PROSPECTS ── */}
          <Section style={styles.section}>
            <Heading style={styles.sectionTitle}>Aperçu — Top 3 prospects</Heading>

            {topProspects.slice(0, 3).map((prospect, index) => {
              const priority = getPriorityConfig(prospect.priorite)
              return (
                <Section key={index} style={styles.prospectCard}>
                  <Row>
                    <Column style={styles.prospectIndex}>
                      <Text style={styles.prospectIndexText}>{index + 1}</Text>
                    </Column>
                    <Column style={styles.prospectInfo}>
                      <Text style={styles.prospectName}>{prospect.raison_sociale}</Text>
                      <Text style={styles.prospectSector}>{prospect.secteur_libelle}</Text>
                    </Column>
                    <Column align="right" style={styles.prospectMeta}>
                      <Text
                        style={{
                          ...styles.priorityBadge,
                          backgroundColor: priority.bg,
                          color: priority.color,
                        }}
                      >
                        {priority.label}
                      </Text>
                      <Text style={styles.scoreText}>{prospect.score}/100</Text>
                    </Column>
                  </Row>
                </Section>
              )
            })}
          </Section>

          {/* ── CTA ── */}
          <Section style={styles.ctaSection}>
            <Button href={appUrl} style={styles.ctaButton}>
              Voir mes {callsCount} appels →
            </Button>
            <Text style={styles.ctaHint}>
              Chaque appel est accompagné d'un pitch sur-mesure, des signaux détectés
              et des réponses aux objections courantes.
            </Text>
          </Section>

          <Hr style={styles.divider} />

          {/* ── RAPPEL PRODUIT ── */}
          <Section style={styles.section}>
            <Row>
              <Column style={styles.featureCol}>
                <Text style={styles.featureIcon}>🔍</Text>
                <Text style={styles.featureLabel}>Sourcing</Text>
                <Text style={styles.featureDesc}>Entreprises ciblées selon vos critères</Text>
              </Column>
              <Column style={styles.featureCol}>
                <Text style={styles.featureIcon}>🧠</Text>
                <Text style={styles.featureLabel}>Qualification</Text>
                <Text style={styles.featureDesc}>Score priorité et signaux d'intention</Text>
              </Column>
              <Column style={styles.featureCol}>
                <Text style={styles.featureIcon}>📞</Text>
                <Text style={styles.featureLabel}>Vous appelez</Text>
                <Text style={styles.featureDesc}>Pitch prêt, contexte complet</Text>
              </Column>
            </Row>
          </Section>

          <Hr style={styles.divider} />

          {/* ── FOOTER ── */}
          <Section style={styles.footer}>
            <Text style={styles.footerBrand}>DecarbonLeads by STROFE</Text>
            <Text style={styles.footerText}>
              Vous recevez cet email car vous êtes inscrit(e) aux notifications quotidiennes.{' '}
              <Link
                href={`${appUrl.replace('/dashboard/daily-list', '')}/dashboard/settings#notifications`}
                style={styles.footerLink}
              >
                Se désabonner
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
  },
  logoText: {
    color: '#ffffff',
    fontSize: '20px',
    fontWeight: '700',
    margin: '0',
    lineHeight: '1.2',
  },
  logoSubtitle: {
    color: '#bbf7d0',
    fontSize: '12px',
    margin: '2px 0 0 0',
  },
  headerDate: {
    color: '#dcfce7',
    fontSize: '13px',
    margin: '0',
    textAlign: 'right' as const,
  },
  // Hero
  hero: {
    padding: '32px 32px 24px',
    textAlign: 'center' as const,
  },
  heroEmoji: {
    fontSize: '40px',
    margin: '0 0 8px 0',
    lineHeight: '1',
  },
  heroTitle: {
    color: '#111827',
    fontSize: '26px',
    fontWeight: '700',
    margin: '0 0 12px 0',
    lineHeight: '1.3',
  },
  heroSubtitle: {
    color: '#6b7280',
    fontSize: '15px',
    margin: '0',
    lineHeight: '1.6',
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
    margin: '0 0 16px 0',
  },
  divider: {
    borderColor: '#e5e7eb',
    margin: '0',
  },
  // Prospect cards
  prospectCard: {
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    padding: '14px 16px',
    marginBottom: '10px',
    border: '1px solid #e5e7eb',
  },
  prospectIndex: {
    width: '32px',
  },
  prospectIndexText: {
    backgroundColor: '#16a34a',
    borderRadius: '50%',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: '700',
    height: '28px',
    lineHeight: '28px',
    margin: '0',
    textAlign: 'center' as const,
    width: '28px',
  },
  prospectInfo: {
    paddingLeft: '12px',
  },
  prospectName: {
    color: '#111827',
    fontSize: '14px',
    fontWeight: '600',
    margin: '0 0 2px 0',
  },
  prospectSector: {
    color: '#6b7280',
    fontSize: '12px',
    margin: '0',
  },
  prospectMeta: {
    textAlign: 'right' as const,
    width: '90px',
  },
  priorityBadge: {
    borderRadius: '4px',
    display: 'inline-block',
    fontSize: '10px',
    fontWeight: '700',
    letterSpacing: '0.05em',
    margin: '0 0 4px 0',
    padding: '2px 6px',
  },
  scoreText: {
    color: '#374151',
    fontSize: '13px',
    fontWeight: '600',
    margin: '0',
  },
  // CTA
  ctaSection: {
    padding: '24px 32px',
    textAlign: 'center' as const,
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
  ctaHint: {
    color: '#9ca3af',
    fontSize: '12px',
    margin: '16px 0 0 0',
    lineHeight: '1.6',
  },
  // Features
  featureCol: {
    padding: '0 12px',
    textAlign: 'center' as const,
    width: '33%',
  },
  featureIcon: {
    fontSize: '24px',
    margin: '0 0 6px 0',
  },
  featureLabel: {
    color: '#374151',
    fontSize: '13px',
    fontWeight: '600',
    margin: '0 0 4px 0',
  },
  featureDesc: {
    color: '#9ca3af',
    fontSize: '12px',
    margin: '0',
    lineHeight: '1.4',
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

export default DailyReadyEmail
