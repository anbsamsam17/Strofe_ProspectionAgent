import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { DailyList, DailyListItem, Prospect } from '@/lib/types'
import { DailyListClient } from '@/components/daily-list/daily-list-client'

function formatDateFr(isoDate: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(
    new Date(isoDate)
  )
}

function StatusBadge({ status }: { status: DailyList['status'] }) {
  const config: Record<
    DailyList['status'],
    { label: string; dotClass: string; className: string }
  > = {
    pending: {
      label: 'En attente',
      dotClass: 'bg-gray-400',
      className:
        'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 ring-1 ring-gray-200 dark:ring-gray-700',
    },
    generating: {
      label: 'Génération en cours...',
      dotClass: 'bg-yellow-500 animate-pulse',
      className:
        'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/60 dark:text-yellow-400 ring-1 ring-yellow-200 dark:ring-yellow-900',
    },
    ready: {
      label: 'Liste prête',
      dotClass: 'bg-green-500',
      className:
        'bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-400 ring-1 ring-green-200 dark:ring-green-900',
    },
    completed: {
      label: 'Journée terminée',
      dotClass: 'bg-blue-500',
      className:
        'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-900',
    },
  }

  const { label, dotClass, className } = config[status]

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${className}`}
      aria-live="polite"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      {label}
    </span>
  )
}

export default async function DailyListPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const today = new Date().toISOString().split('T')[0]

  // Colonnes explicites pour éviter le SELECT * :
  // - daily_lists    : on exclut notified_at (inutile côté dashboard)
  // - daily_list_items : on exclut created_at, updated_at (non affichés)
  // - prospects      : on exclut adresse, contact_*, score_details, signaux
  //                    (colonnes lourdes non nécessaires pour la liste du jour)
  const { data: dailyListData } = await supabase
    .from('daily_lists')
    .select(
      `
      id, user_id, date, status, generated_at, created_at,
      items:daily_list_items(
        id, daily_list_id, user_id, prospect_id,
        ordre, priorite, meilleur_creneau,
        accroche, pitch,
        signaux_detectes, objections_reponses, contact_type,
        call_result, callback_date, call_notes, called_at,
        prospect:prospects(
          id, siren, raison_sociale, secteur_naf, secteur_libelle,
          effectif_min, effectif_max, ville, code_postal,
          contact_nom, contact_prenom, contact_poste, contact_telephone,
          beges_publie, obligation_beges, score_priorite, statut
        )
      )
    `
    )
    .eq('user_id', user.id)
    .eq('date', today)
    .order('ordre', { referencedTable: 'daily_list_items', ascending: true })
    .maybeSingle()

  type DailyListWithItems = DailyList & {
    items: (DailyListItem & { prospect: Prospect })[]
  }

  const dailyList = dailyListData as DailyListWithItems | null

  // Le tri est délégué à PostgreSQL via .order('ordre') — ce fallback est une sécurité.
  const items = dailyList?.items ?? []

  const calledCount = items.filter((i) => i.called_at).length
  const progressPercent = items.length > 0 ? (calledCount / items.length) * 100 : 0

  return (
    <div className="mx-auto max-w-4xl space-y-6">

      {/* ── En-tête ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Liste du jour
          </h1>
          <p className="mt-0.5 text-sm capitalize text-gray-500 dark:text-gray-400">
            {formatDateFr(today)}
          </p>
        </div>
        {dailyList && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              <span className="font-semibold text-gray-900 dark:text-white">{calledCount}</span>
              /{items.length} appels
            </span>
            <StatusBadge status={dailyList.status} />
          </div>
        )}
      </div>

      {/* ── Barre de progression ─────────────────────────────── */}
      {dailyList && items.length > 0 && (
        <div
          className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-800/60 dark:bg-gray-900"
          aria-label="Progression des appels"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Progression
            </span>
            <span className="text-xs font-semibold text-green-600 dark:text-green-400">
              {progressPercent.toFixed(0)}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
              role="progressbar"
              aria-valuenow={calledCount}
              aria-valuemin={0}
              aria-valuemax={items.length}
            />
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-400 dark:text-gray-600">
            <span>{calledCount} effectués</span>
            <span>{items.length - calledCount} restants</span>
          </div>
        </div>
      )}

      {/* ── Liste non générée ────────────────────────────────── */}
      {!dailyList && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white py-20 dark:border-gray-800 dark:bg-gray-900/50">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-50 dark:bg-gray-800">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-gray-300 dark:text-gray-600"
              aria-hidden="true"
            >
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.5 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.27 5.27l1.17-1.17a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.28 15l.64 1.92z" />
            </svg>
          </div>
          <p className="mt-4 text-base font-semibold text-gray-600 dark:text-gray-400">
            Aucune liste générée pour aujourd&apos;hui
          </p>
          <p className="mt-1.5 max-w-xs text-center text-sm text-gray-400 dark:text-gray-600">
            Lancez l&apos;agent depuis le bouton en haut à droite de la page.
          </p>
        </div>
      )}

      {/* ── En génération ────────────────────────────────────── */}
      {dailyList?.status === 'generating' && items.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-yellow-200 bg-yellow-50 py-20 dark:border-yellow-900/40 dark:bg-yellow-950/20">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-950/40">
            <svg
              className="animate-spin text-yellow-600 dark:text-yellow-400"
              xmlns="http://www.w3.org/2000/svg"
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          </div>
          <p className="mt-4 text-base font-semibold text-yellow-800 dark:text-yellow-300">
            Génération des pitchs en cours...
          </p>
          <p className="mt-1 text-sm text-yellow-600 dark:text-yellow-500">
            Cela peut prendre quelques minutes. Rechargez dans un instant.
          </p>
        </div>
      )}

      {/* ── Liste des cards ──────────────────────────────────── */}
      {items.length > 0 && <DailyListClient initialItems={items} />}
    </div>
  )
}
