import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Prospect, ProspectStatus, ScoreDetails, IntentionSignal } from '@/lib/types'
import { ProspectActionsMenu } from '@/components/prospects/prospect-actions-menu'
import { ProspectNotes } from '@/components/prospects/prospect-notes'

export const dynamic = 'force-dynamic'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ProspectStatus, string> = {
  sourced: 'Sourcé',
  qualified: 'Qualifié',
  contacted: 'Contacté',
  interested: 'Intéressé',
  rdv: 'RDV',
  converted: 'Converti',
  rejected: 'Rejeté',
  on_hold: 'En pause',
}

const STATUS_STYLES: Record<ProspectStatus, { badge: string; dot: string }> = {
  sourced: {
    badge: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    dot: 'bg-gray-400',
  },
  qualified: {
    badge: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  contacted: {
    badge: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400',
    dot: 'bg-yellow-500',
  },
  interested: {
    badge: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400',
    dot: 'bg-green-500',
  },
  rdv: {
    badge: 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400',
    dot: 'bg-purple-500',
  },
  converted: {
    badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  rejected: {
    badge: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
    dot: 'bg-red-500',
  },
  on_hold: {
    badge: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
    dot: 'bg-orange-500',
  },
}

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  job_posting: 'Offre emploi RSE',
  sustainability_report_missing: 'Rapport durabilité manquant',
  press_release: 'Communiqué de presse',
  certification: 'Certification',
  event: 'Événement',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | undefined, opts?: Intl.DateTimeFormatOptions): string | null {
  if (!dateStr) return null
  try {
    return new Intl.DateTimeFormat('fr-FR', opts ?? { dateStyle: 'long' }).format(new Date(dateStr))
  } catch {
    return null
  }
}

function priorityFromScore(score: number): { label: string; className: string } {
  if (score >= 75) return { label: 'Haute priorité', className: 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800' }
  if (score >= 50) return { label: 'Priorité normale', className: 'bg-yellow-50 text-yellow-700 border border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-400 dark:border-yellow-800' }
  return { label: 'Basse priorité', className: 'bg-gray-100 text-gray-500 border border-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:border-gray-700' }
}

function scoreBarColor(score: number): string {
  if (score >= 75) return 'bg-green-500'
  if (score >= 50) return 'bg-yellow-500'
  return 'bg-gray-400'
}

// ── Sous-composants UI ────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 px-6 py-4 dark:border-gray-800">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {title}
        </h2>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-40 flex-shrink-0 text-sm text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-sm font-medium text-gray-900 dark:text-white">{value}</dd>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ id: string }>
}

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

  const { data, error } = await supabase
    .from('prospects')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !data) notFound()

  const prospect = data as unknown as Prospect

  const statusStyle = STATUS_STYLES[prospect.statut] ?? STATUS_STYLES.sourced
  const priority = priorityFromScore(prospect.score_priorite)
  const scoreDetails = prospect.score_details as ScoreDetails
  const signaux = (prospect.signaux ?? []) as IntentionSignal[]

  // Noms contact
  const contactFullName = [prospect.contact_prenom, prospect.contact_nom].filter(Boolean).join(' ')

  // Effectif
  const effectif =
    prospect.effectif_min && prospect.effectif_max
      ? `${prospect.effectif_min}\u2013${prospect.effectif_max} salariés`
      : prospect.effectif_min
        ? `+${prospect.effectif_min} salariés`
        : null

  // BEGES
  const begesValide = prospect.beges_publie && prospect.beges_valide
  const begesExpire = prospect.beges_publie && !prospect.beges_valide
  const begesAbsent = !prospect.beges_publie

  return (
    <div className="mx-auto max-w-5xl space-y-5">

      {/* ── Header ── */}
      <div>
        <Link
          href="/prospects"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
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

        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              {prospect.raison_sociale}
            </h1>
            {prospect.siren && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                SIREN {prospect.siren}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Badge statut */}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${statusStyle.badge}`}
            >
              <span
                className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${statusStyle.dot}`}
                aria-hidden="true"
              />
              {STATUS_LABELS[prospect.statut] ?? prospect.statut}
            </span>

            {/* Badge priorité */}
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${priority.className}`}
            >
              {priority.label}
            </span>

            {/* Badge archive */}
            {prospect.archived_at && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-sm font-medium text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-400">
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

            {/* Menu actions CRM */}
            <ProspectActionsMenu
              prospectId={prospect.id}
              prospectName={prospect.raison_sociale}
              currentStatut={prospect.statut}
              archived={Boolean(prospect.archived_at)}
            />
          </div>
        </div>
      </div>

      {/* ── Grille principale (1 col mobile, 2 cols desktop) ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

        {/* ── Section Informations entreprise ── */}
        <SectionCard title="Informations entreprise">
          <dl className="space-y-3">
            {prospect.siren && (
              <InfoRow label="SIREN" value={prospect.siren} />
            )}
            {prospect.siret && (
              <InfoRow label="SIRET" value={prospect.siret} />
            )}
            {prospect.secteur_naf && (
              <InfoRow
                label="Code NAF"
                value={
                  <span>
                    {prospect.secteur_naf}
                    {prospect.secteur_libelle && (
                      <span className="ml-1 text-gray-500 dark:text-gray-400">
                        — {prospect.secteur_libelle}
                      </span>
                    )}
                  </span>
                }
              />
            )}
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
                <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  {prospect.source}
                </span>
              }
            />
          </dl>
        </SectionCard>

        {/* ── Section Contact ── */}
        <SectionCard title="Contact identifié">
          {contactFullName || prospect.contact_telephone || prospect.contact_email || prospect.contact_linkedin ? (
            <div className="space-y-4">
              {contactFullName && (
                <div>
                  <p className="text-base font-semibold text-gray-900 dark:text-white">
                    {contactFullName}
                  </p>
                  {prospect.contact_poste && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {prospect.contact_poste}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2.5">
                {prospect.contact_telephone && (
                  <a
                    href={`tel:${prospect.contact_telephone.replace(/\s/g, '')}`}
                    className="inline-flex items-center gap-2 text-sm font-medium text-green-600 transition-colors hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                    aria-label={`Appeler le ${prospect.contact_telephone}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.5 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.27 5.27l1.17-1.17a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.28 15l.64 1.92z" />
                    </svg>
                    {prospect.contact_telephone}
                  </a>
                )}

                {prospect.contact_email && (
                  <a
                    href={`mailto:${prospect.contact_email}`}
                    className="flex items-center gap-2 text-sm font-medium text-green-600 transition-colors hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                    aria-label={`Envoyer un email à ${prospect.contact_email}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    {prospect.contact_email}
                  </a>
                )}

                {prospect.contact_linkedin && (
                  <a
                    href={prospect.contact_linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    aria-label={`Voir le profil LinkedIn de ${contactFullName || 'ce contact'} (ouvre dans un nouvel onglet)`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                    LinkedIn
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-600">
              Aucun contact identifié pour cette entreprise.
            </p>
          )}
        </SectionCard>

        {/* ── Section BEGES ── */}
        <SectionCard title="Bilan GES (BEGES)">
          <div className="space-y-4">
            {/* Badge état principal */}
            <div className="flex flex-wrap items-center gap-2">
              {begesValide && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-sm font-semibold text-green-700 dark:border-green-800 dark:bg-green-950/50 dark:text-green-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  BEGES valide
                </span>
              )}
              {begesExpire && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-700 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  BEGES expiré
                </span>
              )}
              {begesAbsent && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-sm font-semibold text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  BEGES absent
                </span>
              )}
              {prospect.obligation_beges && (
                <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-sm font-medium text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-400">
                  Obligation BEGES
                </span>
              )}
            </div>

            {/* Date de dernière publication */}
            {prospect.beges_derniere_publication && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Dernière publication :{' '}
                <span className="font-medium text-gray-900 dark:text-white">
                  {formatDate(prospect.beges_derniere_publication, { dateStyle: 'long' })}
                </span>
              </p>
            )}

            {/* Lien ADEME */}
            {prospect.beges_url && (
              <a
                href={prospect.beges_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600 transition-colors hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                aria-label={`Voir le BEGES de ${prospect.raison_sociale} sur ADEME (ouvre dans un nouvel onglet)`}
              >
                Voir le BEGES sur ADEME
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            )}

            {/* Explication obligation */}
            <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">
              {prospect.obligation_beges
                ? "Cette entreprise est soumise à l'obligation de publier son BEGES (bilan de gaz à effet de serre) en raison de son effectif ou de sa nature juridique."
                : "Cette entreprise n'est pas soumise à l'obligation réglementaire, mais une démarche volontaire de bilan carbone reste possible et valorisante."}
            </p>
          </div>
        </SectionCard>

        {/* ── Section Score ── */}
        <SectionCard title="Score de priorité">
          <div className="space-y-5">
            {/* Barre de progression globale */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm text-gray-500 dark:text-gray-400">Score global</span>
                <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
                  {prospect.score_priorite}
                  <span className="ml-1 text-sm font-normal text-gray-400">/100</span>
                </span>
              </div>
              <div
                className="h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
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

            {/* Décomposition du score */}
            {scoreDetails && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  Décomposition
                </p>
                <dl className="space-y-2">
                  {scoreDetails.obligation_beges !== 0 && (
                    <ScoreRow label="Obligation BEGES" value={scoreDetails.obligation_beges} />
                  )}
                  {scoreDetails.secteur_prioritaire !== 0 && (
                    <ScoreRow label="Secteur prioritaire" value={scoreDetails.secteur_prioritaire} />
                  )}
                  {scoreDetails.beges_non_publie !== 0 && (
                    <ScoreRow label="BEGES non publié / expiré" value={scoreDetails.beges_non_publie} />
                  )}
                  {scoreDetails.signaux_intention !== 0 && (
                    <ScoreRow label="Signaux d'intention" value={scoreDetails.signaux_intention} />
                  )}
                  {scoreDetails.taille_entreprise !== 0 && (
                    <ScoreRow label="Taille entreprise" value={scoreDetails.taille_entreprise} />
                  )}
                  {scoreDetails.contact_trouve !== 0 && (
                    <ScoreRow label="Contact trouvé" value={scoreDetails.contact_trouve} />
                  )}
                  {scoreDetails.penalite_deja_contacte !== 0 && (
                    <ScoreRow label="Déjà contacté" value={scoreDetails.penalite_deja_contacte} penalty />
                  )}
                  {scoreDetails.penalite_rejete !== 0 && (
                    <ScoreRow label="Rejeté" value={scoreDetails.penalite_rejete} penalty />
                  )}
                </dl>
              </div>
            )}
          </div>
        </SectionCard>

      </div>

      {/* ── Section Signaux RSE (pleine largeur) ── */}
      <SectionCard title={`Signaux RSE${signaux.length > 0 ? ` (${signaux.length})` : ''}`}>
        {signaux.length > 0 ? (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800" aria-label="Liste des signaux RSE détectés">
            {signaux.map((signal, idx) => (
              <li key={idx} className="flex flex-wrap items-start gap-3 py-3.5 first:pt-0 last:pb-0">
                <span className="mt-0.5 flex-shrink-0">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/40">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      {SIGNAL_TYPE_LABELS[signal.type] ?? signal.type}
                    </span>
                    {signal.weight > 0 && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950/40 dark:text-green-400">
                        +{signal.weight} pts
                      </span>
                    )}
                    {signal.date && (
                      <span className="text-xs text-gray-400 dark:text-gray-600">
                        {formatDate(signal.date, { dateStyle: 'medium' }) ?? signal.date}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
                    {signal.description}
                  </p>
                  {signal.url && (
                    <a
                      href={signal.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                      aria-label={`Source du signal (ouvre dans un nouvel onglet)`}
                    >
                      Voir la source
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-600">
            Aucun signal RSE détecté pour cette entreprise.
          </p>
        )}
      </SectionCard>

      {/* ── Section Notes (édition inline avec debounce) ── */}
      <div id="notes" className="scroll-mt-6">
        <SectionCard title="Notes">
          <ProspectNotes prospectId={prospect.id} initialNotes={prospect.notes ?? null} />
        </SectionCard>
      </div>

      {/* ── Section Historique ── */}
      <SectionCard title="Historique">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Créé le
            </dt>
            <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
              {formatDate(prospect.created_at, { dateStyle: 'long' }) ?? '—'}
            </dd>
          </div>
          {prospect.enriched_at && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Enrichi le
              </dt>
              <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                {formatDate(prospect.enriched_at, { dateStyle: 'long' }) ?? '—'}
              </dd>
            </div>
          )}
          {prospect.archived_at && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Archivé le
              </dt>
              <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                {formatDate(prospect.archived_at, { dateStyle: 'long' }) ?? '—'}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Dernière mise à jour
            </dt>
            <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
              {formatDate(prospect.updated_at, { dateStyle: 'long' }) ?? '—'}
            </dd>
          </div>
        </dl>
      </SectionCard>

    </div>
  )
}

// ── ScoreRow ──────────────────────────────────────────────────────────────────

function ScoreRow({
  label,
  value,
  penalty = false,
}: {
  label: string
  value: number
  penalty?: boolean
}) {
  const sign = penalty ? '' : value > 0 ? '+' : ''
  const color = penalty || value < 0
    ? 'text-red-600 dark:text-red-400'
    : 'text-green-600 dark:text-green-400'

  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-sm text-gray-600 dark:text-gray-400">{label}</dt>
      <dd className={`text-sm font-semibold tabular-nums ${color}`}>
        {sign}{value} pts
      </dd>
    </div>
  )
}
