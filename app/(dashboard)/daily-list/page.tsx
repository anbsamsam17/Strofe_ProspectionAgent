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
    { label: string; className: string }
  > = {
    pending: {
      label: 'En attente de génération',
      className:
        'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    },
    generating: {
      label: 'Génération en cours...',
      className:
        'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400',
    },
    ready: {
      label: 'Liste prête',
      className:
        'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
    },
    completed: {
      label: 'Journée terminée',
      className:
        'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
    },
  }

  const { label, className } = config[status]

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${className}`}
      aria-live="polite"
    >
      {status === 'generating' && (
        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" aria-hidden="true" />
      )}
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
  // On délègue aussi le tri `ordre` à PostgreSQL plutôt qu'en JS post-fetch.
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

  // Le tri est désormais délégué à PostgreSQL via .order('ordre') dans la requête.
  // On conserve ce fallback JS uniquement comme sécurité si Supabase réordonne.
  const items = dailyList?.items ?? []

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Vos {items.length > 0 ? items.length : 15} appels du{' '}
            {formatDateFr(today)}
          </h1>
          {dailyList && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {items.filter((i) => i.called_at).length} effectués sur{' '}
              {items.length}
            </p>
          )}
        </div>
        {dailyList && <StatusBadge status={dailyList.status} />}
      </div>

      {/* Barre de progression */}
      {dailyList && items.length > 0 && (
        <div className="space-y-1" aria-label="Progression des appels">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
            <div
              className="h-2 rounded-full bg-green-500 transition-all"
              style={{
                width: `${(items.filter((i) => i.called_at).length / items.length) * 100}%`,
              }}
              role="progressbar"
              aria-valuenow={items.filter((i) => i.called_at).length}
              aria-valuemin={0}
              aria-valuemax={items.length}
            />
          </div>
        </div>
      )}

      {/* Liste non générée */}
      {!dailyList && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 py-20 dark:border-gray-700">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mb-4 text-gray-300 dark:text-gray-700"
            aria-hidden="true"
          >
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.5 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.27 5.27l1.17-1.17a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.28 15l.64 1.92z" />
          </svg>
          <p className="text-base font-medium text-gray-500 dark:text-gray-400">
            Aucune liste générée pour aujourd&apos;hui
          </p>
          <p className="mt-1 text-sm text-gray-400 dark:text-gray-600">
            Lancez l&apos;agent depuis le bouton en haut à droite de la page.
          </p>
        </div>
      )}

      {/* Liste en génération */}
      {dailyList?.status === 'generating' && items.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-yellow-200 bg-yellow-50 py-20 dark:border-yellow-900 dark:bg-yellow-950/30">
          <svg
            className="mb-4 animate-spin text-yellow-500"
            xmlns="http://www.w3.org/2000/svg"
            width="40"
            height="40"
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
          <p className="text-base font-medium text-yellow-700 dark:text-yellow-400">
            Génération des pitchs en cours...
          </p>
          <p className="mt-1 text-sm text-yellow-600 dark:text-yellow-500">
            Cela peut prendre quelques minutes. Rechargez la page dans un instant.
          </p>
        </div>
      )}

      {/* Liste des cards */}
      {items.length > 0 && <DailyListClient initialItems={items} />}
    </div>
  )
}
