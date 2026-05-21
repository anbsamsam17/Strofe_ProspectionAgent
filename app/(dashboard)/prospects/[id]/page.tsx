import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type {
  Priority,
  Prospect,
  ScoreDetails,
  ScoringWeights,
  CallResult,
} from '@/lib/types'
import { ProspectActionsMenu } from '@/components/prospects/prospect-actions-menu'
import { ProspectNotes } from '@/components/prospects/prospect-notes'
import { ProspectDetailEditor } from '@/components/prospects/prospect-detail-editor'
import { StatusDropdown } from '@/components/prospects/status-dropdown'
import { PriorityDropdown } from '@/components/prospects/priority-dropdown'
import { ContactsList, type ProspectContact } from '@/components/prospects/contacts-list'
import { DealValueEditor } from '@/components/prospects/deal-value-editor'
import { ExchangesPanel, type ProspectExchange } from '@/components/prospects/exchanges-panel'
import { buildBegesUrl } from '@/lib/utils/beges-url'
import { isBegesExpiringSoon } from '@/lib/agent/beges-expiration'
import {
  getDecret2022Reason,
  formatDecret2022ReasonLabel,
} from '@/lib/agent/decret-2022'
import { NafHierarchyView } from '@/components/prospects/naf-hierarchy-view'
import { SendEmailButton } from '@/components/email/send-email-button'
import { TEMPLATES } from '@/lib/email/templates/prospection'
import type { EmailPersona } from '@/lib/email/detect-persona'

export const dynamic = 'force-dynamic'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | undefined, opts?: Intl.DateTimeFormatOptions): string | null {
  if (!dateStr) return null
  try {
    return new Intl.DateTimeFormat('fr-FR', opts ?? { dateStyle: 'long' }).format(new Date(dateStr))
  } catch {
    return null
  }
}

function scoreBarColor(score: number): string {
  if (score >= 75) return 'bg-green-500'
  if (score >= 50) return 'bg-yellow-500'
  return 'bg-white/30'
}

// ── Sous-composants UI ────────────────────────────────────────────────────────

function SectionCard({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-6 py-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-400/80">
          {title}
        </h2>
        {action}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
      <dt className="w-40 flex-shrink-0 text-sm text-gray-400">{label}</dt>
      <dd className="text-sm font-medium text-white">{value}</dd>
    </div>
  )
}

function ScoreRow({
  label,
  pillar,
  weight,
}: {
  label: string
  pillar: number
  weight: number
}) {
  // Contribution pondérée arrondie (sur 100).
  const contribution = Math.round((pillar * weight) / 100)
  // Pourcentage atteint pour ce pilier (sur sa pondération max).
  const pct = weight > 0 ? Math.min(100, Math.max(0, (contribution / weight) * 100)) : 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <dt className="flex items-center gap-2 text-sm text-gray-300">
          <span>{label}</span>
          <span className="text-xs text-gray-400">(pondération {weight}%)</span>
        </dt>
        <dd className="text-sm font-semibold tabular-nums text-white">
          {contribution} / {weight} pts
        </dd>
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-white/[0.06]"
        aria-hidden="true"
      >
        <div
          className="h-1 rounded-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function PenaltyRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-sm text-red-300">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-red-300">
        {value > 0 ? `-${value}` : value} pts
      </dd>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ id: string }>
}

// La priorité manuelle (migration 009) n'est pas encore sur le type Prospect.
// TODO(coord-A): exposer `priorite` dans `lib/types.ts` Prospect.
type ManualPriority = Extract<Priority, 'haute' | 'moyenne' | 'basse'>
interface ProspectRow extends Prospect {
  priorite?: ManualPriority
}

const DEFAULT_WEIGHTS: ScoringWeights = { taille: 30, beges: 30, contact: 40 }

export default async function ProspectDetailPage({ params }: PageProps) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { id } = await params

  // Validation UUID stricte (RFC 4122)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(id)) notFound()

  // RLS implicite — la session SSR filtre déjà par user_id.
  const { data, error } = await supabase
    .from('prospects')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) notFound()

  const prospect = data as unknown as ProspectRow

  // Contacts multi-prospect (migration 011).
  const { data: contactsRaw } = await supabase
    .from('prospect_contacts')
    .select('*')
    .eq('prospect_id', id)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  const contacts = (contactsRaw ?? []) as unknown as ProspectContact[]

  // Échanges manuels libres (migration 012).
  const { data: exchangesRaw } = await supabase
    .from('prospect_exchanges')
    .select('*')
    .eq('prospect_id', id)
    .order('occurred_at', { ascending: false })

  const exchanges = (exchangesRaw ?? []) as unknown as ProspectExchange[]

  // Post-pivot 2026-05-15 : daily_list_items supprimée.
  // L'historique d'appels est désormais 100% dans prospect_exchanges.
  const calls: Array<{
    id: string
    called_at: string
    call_result: CallResult | null
    call_notes: string | null
    callback_date: string | null
  }> = []

  const scoreDetails = prospect.score_details as ScoreDetails | null
  const weights: ScoringWeights = scoreDetails?.weights ?? DEFAULT_WEIGHTS
  const begesUrl = buildBegesUrl(prospect)
  const currentPriorite: ManualPriority = prospect.priorite ?? 'moyenne'

  // GLN-020 : préparation données EmailComposer
  // first_contact_at est ajouté par migration 022 — colonne pas encore dans
  // database.types.ts. Cast safe : si null/undefined → firstContact = true.
  const firstContact = (prospect as unknown as { first_contact_at?: string | null })
    .first_contact_at == null
  const emailComposerContacts = contacts.map((c) => ({
    id: c.id,
    prenom: c.prenom,
    nom: c.nom,
    email: c.email,
    email_status: (c as unknown as { email_status?: string | null }).email_status ?? null,
    poste: c.poste,
  }))

  // Fallback legacy (GLN-020 fix 2026-05-20) :
  // L'API /api/prospects/[id]/enrich écrit dans les colonnes legacy
  // `prospects.contact_*` (pas dans `prospect_contacts`). Si l'utilisateur
  // a enrichi via UI mais que la table normalisée est vide, on synthétise
  // un pseudo-contact `legacy-<prospectId>` pour permettre l'envoi email.
  // Côté API `/api/email/send`, ce préfixe est détecté et le contact
  // est lu depuis `prospects.contact_*` au lieu de `prospect_contacts`.
  const hasValidContact = emailComposerContacts.some((c) => c.email)
  if (!hasValidContact && prospect.contact_email) {
    emailComposerContacts.push({
      id: `legacy-${prospect.id}`,
      prenom: prospect.contact_prenom ?? null,
      nom: prospect.contact_nom ?? null,
      email: prospect.contact_email,
      email_status: null,
      poste: prospect.contact_poste ?? null,
    })
  }
  const emailTemplates: Record<EmailPersona, { subject: string; body: string }> = {
    daf: { subject: TEMPLATES.daf.subject, body: TEMPLATES.daf.body },
    rse: { subject: TEMPLATES.rse.subject, body: TEMPLATES.rse.body },
    dg: { subject: TEMPLATES.dg.subject, body: TEMPLATES.dg.body },
    drh: { subject: TEMPLATES.drh.subject, body: TEMPLATES.drh.body },
  }

  // Effectif
  const effectif =
    prospect.effectif_min && prospect.effectif_max
      ? `${prospect.effectif_min}–${prospect.effectif_max} salariés`
      : prospect.effectif_min
        ? `+${prospect.effectif_min} salariés`
        : null

  // BEGES
  const begesValide = prospect.beges_publie && prospect.beges_valide
  const begesExpire = prospect.beges_publie && !prospect.beges_valide
  const begesAbsent = !prospect.beges_publie

  return (
    <div className="mx-auto max-w-5xl space-y-5">

      {/* ── Header retour ── */}
      <div>
        <Link
          href="/prospects"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-white"
          aria-label="Retour à la liste des prospects"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Prospects
        </Link>

        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              {prospect.raison_sociale}
            </h1>
            {prospect.siren && (
              <p className="mt-1.5 font-mono text-sm tabular-nums text-gray-400">
                SIREN {prospect.siren}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <StatusDropdown
              prospectId={prospect.id}
              currentStatut={prospect.statut}
            />
            <PriorityDropdown
              prospectId={prospect.id}
              currentPriorite={currentPriorite}
            />

            {/* GLN-081 — Badge "Hot lead" (composite : obligation + BEGES défaillant
                + email + effectif >= 250). Cliquable visuellement neutre — sert juste
                à signaler la priorisation au consultant. */}
            {prospect.is_hot_lead && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-1 text-sm font-semibold text-red-200 ring-1 ring-red-500/25"
                title="Top opportunité : obligation BEGES + BEGES défaillant + email disponible + effectif >= 250 sal."
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
                </svg>
                Hot lead
              </span>
            )}

            {/* Badge archive */}
            {prospect.archived_at && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/15 px-3 py-1 text-sm font-medium text-orange-200 ring-1 ring-orange-500/25">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="21 8 21 21 3 21 3 8" />
                  <rect x="1" y="3" width="22" height="5" />
                  <line x1="10" y1="12" x2="14" y2="12" />
                </svg>
                Archivé
              </span>
            )}

            {/* CTA envoi email (GLN-020) */}
            <SendEmailButton
              prospectId={prospect.id}
              prospectRaisonSociale={prospect.raison_sociale}
              firstContact={firstContact}
              contacts={emailComposerContacts}
              templates={emailTemplates}
            />

            {/* Menu actions secondaires (archiver, supprimer, etc.) */}
            <div className="ml-1">
              <ProspectActionsMenu
                prospectId={prospect.id}
                prospectName={prospect.raison_sociale}
                currentStatut={prospect.statut}
                archived={Boolean(prospect.archived_at)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Grille principale (1 col mobile, 2 cols desktop) ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

        {/* ── Informations entreprise ── */}
        <SectionCard title="Informations entreprise">
          <ProspectDetailEditor prospect={prospect} section="identity">
            <dl className="space-y-3">
              {prospect.siren && (
                <InfoRow label="SIREN" value={prospect.siren} />
              )}
              {prospect.siret && (
                <InfoRow label="SIRET" value={prospect.siret} />
              )}
              <InfoRow
                label="Activité NAF"
                value={
                  <NafHierarchyView
                    rawNaf={prospect.secteur_naf ?? null}
                  />
                }
              />
              {effectif && (
                <InfoRow label="Effectif" value={effectif} />
              )}
              {(prospect.ville || prospect.code_postal) && (
                <InfoRow
                  label="Localisation"
                  value={[prospect.adresse, prospect.code_postal, prospect.ville]
                    .filter(Boolean)
                    .join(', ')}
                />
              )}
              <InfoRow
                label="Source"
                value={
                  <span className="inline-flex items-center rounded-md bg-white/[0.05] px-2 py-0.5 text-xs font-medium text-gray-300 ring-1 ring-white/[0.08]">
                    {prospect.source}
                  </span>
                }
              />
            </dl>
          </ProspectDetailEditor>
        </SectionCard>

        {/* ── Score de priorité (anciennement à l'ancienne place du "Statut CRM") ── */}
        <SectionCard title="Score de priorité">
          <div className="space-y-5">
            {/* Barre de progression globale */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm text-gray-400">Score global</span>
                <span className="text-2xl font-bold tabular-nums text-white">
                  {prospect.score_priorite}
                  <span className="ml-1 text-sm font-normal text-gray-400">/100</span>
                </span>
              </div>
              <div
                className="h-3 overflow-hidden rounded-full bg-white/[0.08]"
                role="progressbar"
                aria-valuenow={prospect.score_priorite}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Score de priorité : ${prospect.score_priorite} sur 100`}
              >
                <div
                  className={`h-3 rounded-full transition-all ${scoreBarColor(prospect.score_priorite)}`}
                  style={{ width: `${Math.min(100, prospect.score_priorite)}%` }}
                />
              </div>
            </div>

            {/* Décomposition 3 piliers */}
            {scoreDetails && (
              <div className="space-y-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
                  {'// Décomposition'}
                </p>
                <dl className="space-y-3">
                  <ScoreRow label="Taille" pillar={scoreDetails.taille ?? 0} weight={weights.taille} />
                  <ScoreRow label="BEGES" pillar={scoreDetails.beges ?? 0} weight={weights.beges} />
                  <ScoreRow label="Contact" pillar={scoreDetails.contact ?? 0} weight={weights.contact} />
                </dl>

                {(scoreDetails.deja_contacte_penalty > 0 || scoreDetails.rejete_penalty > 0) && (
                  <dl className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3">
                    {scoreDetails.deja_contacte_penalty > 0 && (
                      <PenaltyRow label="Déjà contacté" value={scoreDetails.deja_contacte_penalty} />
                    )}
                    {scoreDetails.rejete_penalty > 0 && (
                      <PenaltyRow label="Rejeté" value={scoreDetails.rejete_penalty} />
                    )}
                  </dl>
                )}
              </div>
            )}

            {/* Caption pondérations */}
            <p className="text-xs text-gray-400">
              Pondération actuelle : Taille {weights.taille}% · BEGES {weights.beges}% · Contact{' '}
              {weights.contact}%{' '}
              <Link
                href="/settings#scoring"
                className="ml-1 font-medium text-green-400 hover:text-green-300"
              >
                Modifier
              </Link>
            </p>
          </div>
        </SectionCard>

        {/* ── Deal (GLN-041) — valeur EUR + probabilite + forecast ── */}
        <SectionCard title="Deal">
          <DealValueEditor
            prospectId={prospect.id}
            statut={prospect.statut}
            initialDealValue={prospect.deal_value ?? null}
            initialDealProbability={prospect.deal_probability ?? null}
          />
        </SectionCard>

        {/* ── Contacts identifiés (multi) ── */}
        <ContactsList prospect={prospect} contacts={contacts} />

        {/* ── BEGES ── */}
        <SectionCard title="Bilan GES (BEGES)">
          <ProspectDetailEditor prospect={prospect} section="beges">
            <div className="space-y-4">
              {/* Badge état principal */}
              <div className="flex flex-wrap items-center gap-2">
                {begesValide && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/15 px-3 py-1 text-sm font-semibold text-green-200 ring-1 ring-green-500/25">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    BEGES valide
                  </span>
                )}
                {begesExpire && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/15 px-3 py-1 text-sm font-semibold text-orange-200 ring-1 ring-orange-500/25">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    BEGES expiré
                  </span>
                )}
                {begesAbsent && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-1 text-sm font-semibold text-red-200 ring-1 ring-red-500/25">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                    BEGES absent
                  </span>
                )}
                {prospect.obligation_beges && (
                  <span className="inline-flex items-center rounded-full bg-orange-500/15 px-3 py-1 text-sm font-medium text-orange-200 ring-1 ring-orange-500/25">
                    Obligation BEGES
                  </span>
                )}
                {/* GLN-080 — Badge "BEGES expirant" : la validité tombe à
                    échéance dans <= 90 jours (3 ans public / 4 ans privé
                    selon Art. L229-25). Signal commercial (renouvellement
                    imminent). Scope volontairement réduit : pas de cron ni
                    d'envoi email — juste un badge UI. */}
                {isBegesExpiringSoon({
                  beges_derniere_publication: prospect.beges_derniere_publication ?? null,
                  entite_publique: prospect.entite_publique ?? null,
                }) && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/15 px-3 py-1 text-sm font-medium text-orange-200 ring-1 ring-orange-500/25"
                    title="Le BEGES de ce prospect expire dans moins de 3 mois (calcul Art. L229-25 + validité publique/privée)."
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    BEGES expirant
                  </span>
                )}
                {/* GLN-006 — Badge "Non conforme Décret 2022" :
                    BEGES publié post-2023 sans scope 3 ou sans plan d'action
                    (Décret 2022-982 art. 1). Signal commercial fort —
                    renouvellement quasi-obligatoire. Le détail "scope 3
                    manquant" / "plan d'action manquant" est affiché en
                    sous-texte pour préciser le pitch commercial. */}
                {prospect.beges_decret_2022_compliant === false && (() => {
                  const decretReason = getDecret2022Reason(
                    prospect.bilan_ges_data as Record<string, unknown> | null,
                  )
                  const reasonLabel = formatDecret2022ReasonLabel(decretReason)
                  return (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/15 px-3 py-1 text-sm font-medium text-orange-200 ring-1 ring-orange-500/25"
                      title="BEGES publié sans scope 3 ou sans plan d'action de transition — renouvellement nécessaire selon Décret 2022-982 art. 1"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>
                        Non conforme Décret 2022
                        {reasonLabel && (
                          <span className="ml-1 text-xs text-orange-300/80">
                            ({reasonLabel})
                          </span>
                        )}
                      </span>
                    </span>
                  )
                })()}
              </div>

              {prospect.beges_derniere_publication && (
                <p className="text-sm text-gray-300">
                  Dernière publication :{' '}
                  <span className="font-medium text-white">
                    {formatDate(prospect.beges_derniere_publication, { dateStyle: 'long' })}
                  </span>
                </p>
              )}

              {begesUrl && (
                <a
                  href={begesUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-green-400 transition-colors hover:text-green-300"
                  aria-label={`Voir le BEGES de ${prospect.raison_sociale} sur bilans-ges.ademe.fr (ouvre dans un nouvel onglet)`}
                >
                  Voir le BEGES sur bilans-ges.ademe.fr
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              )}

              <p className="text-sm leading-relaxed text-gray-300">
                {prospect.obligation_beges
                  ? "Cette entreprise est soumise à l'obligation de publier son BEGES (bilan de gaz à effet de serre) en raison de son effectif ou de sa nature juridique."
                  : "Cette entreprise n'est pas soumise à l'obligation réglementaire, mais une démarche volontaire de bilan carbone reste possible et valorisante."}
              </p>
            </div>
          </ProspectDetailEditor>
        </SectionCard>

      </div>

      {/* ── Historique des échanges (avant Notes — inversion demandée) ── */}
      <ExchangesPanel prospectId={prospect.id} exchanges={exchanges} calls={calls} />

      {/* ── Notes ── */}
      <div id="notes" className="scroll-mt-6">
        <SectionCard title="Notes">
          <ProspectNotes prospectId={prospect.id} initialNotes={prospect.notes ?? null} />
        </SectionCard>
      </div>

      {/* ── Métadonnées ── */}
      <SectionCard title="Métadonnées">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <dt className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
              Créé le
            </dt>
            <dd className="text-sm font-medium text-white">
              {formatDate(prospect.created_at, { dateStyle: 'long' }) ?? '—'}
            </dd>
          </div>
          {prospect.enriched_at && (
            <div>
              <dt className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-400/80">
                Enrichi le
              </dt>
              <dd className="text-sm font-medium text-white">
                {formatDate(prospect.enriched_at, { dateStyle: 'long' }) ?? '—'}
              </dd>
            </div>
          )}
          {prospect.archived_at && (
            <div>
              <dt className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-orange-400/80">
                Archivé le
              </dt>
              <dd className="text-sm font-medium text-white">
                {formatDate(prospect.archived_at, { dateStyle: 'long' }) ?? '—'}
              </dd>
            </div>
          )}
          <div>
            <dt className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
              Dernière mise à jour
            </dt>
            <dd className="text-sm font-medium text-white">
              {formatDate(prospect.updated_at, { dateStyle: 'long' }) ?? '—'}
            </dd>
          </div>
        </dl>
      </SectionCard>

    </div>
  )
}
