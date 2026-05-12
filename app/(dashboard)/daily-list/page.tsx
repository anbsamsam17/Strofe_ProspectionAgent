import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { DailyList, DailyListItem, Prospect } from '@/lib/types'
import { DailyListClient } from '@/components/daily-list/daily-list-client'

// Force le rendu dynamique — la daily list doit toujours être fraîche
// (données temps-réel : appels effectués, nouveaux prospects ajoutés)
export const dynamic = 'force-dynamic'

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

  // Une seule instance de Date — évite le bug "à minuit"
  const today = new Date().toISOString().split('T')[0]

  // BUG-FIX : Afficher les TOP 15 non appelés triés par score parmi TOUS les items
  // de la liste du jour (pas seulement les 15 derniers ajoutés).
  //
  // Stratégie en 2 requêtes :
  //  1. Récupérer la daily_list du jour pour obtenir son statut global
  //  2. Récupérer les items non appelés (called_at IS NULL) triés par score DESC + LIMIT 15
  //     ET les items déjà appelés (pour afficher la progression complète)
  //
  // BUG-FIX .order(referencedTable) + .maybeSingle() : combinaison incompatible documentée
  // dans hindsight.md. On utilise .maybeSingle() SANS .order(referencedTable) et on trie JS.

  // Requête 1 : statut de la daily_list du jour
  const { data: dailyListData } = await supabase
    .from('daily_lists')
    .select('id, user_id, date, status, generated_at, created_at')
    .eq('user_id', user.id)
    .eq('date', today)
    .maybeSingle()

  const dailyList = dailyListData as DailyList | null

  // Requête 2 : items de la daily_list du jour avec leurs prospects
  // On récupère TOUS les items (appelés + non appelés) pour la barre de progression.
  // Le tri par score se fait côté JS pour éviter le piège .order(referencedTable) + maybeSingle.
  let allItems: (DailyListItem & { prospect: Prospect })[] = []

  if (dailyList) {
    const { data: itemsData } = await supabase
      .from('daily_list_items')
      .select(`
        id, daily_list_id, user_id, prospect_id,
        ordre, priorite, meilleur_creneau,
        accroche, pitch, created_at,
        signaux_detectes, objections_reponses, contact_type,
        call_result, callback_date, call_notes, called_at,
        prospect:prospects(
          id, siren, raison_sociale, secteur_naf, secteur_libelle,
          effectif_min, effectif_max, ville, code_postal,
          contact_nom, contact_prenom, contact_poste, contact_telephone, contact_email, contact_linkedin,
          beges_publie, beges_derniere_publication, beges_url, beges_valide,
          obligation_beges, score_priorite, statut
        )
      `)
      .eq('daily_list_id', dailyList.id)
      .eq('user_id', user.id)

    allItems = (itemsData ?? []) as unknown as (DailyListItem & { prospect: Prospect })[]
  }

  // BUG-FIX : Trier côté JS par score DESC
  // - Items non appelés (called_at IS NULL) : triés par score DESC — ce sont les TOP 15 à appeler
  // - Items appelés (called_at NOT NULL) : triés par called_at ASC — historique des appels effectués
  //
  // La page affiche EN PREMIER les non-appelés triés par score (l'essentiel),
  // puis les appelés en dessous (historique consultatif).
  const uncalledItems = allItems
    .filter((i) => !i.called_at)
    .sort((a, b) => (b.prospect?.score_priorite ?? 0) - (a.prospect?.score_priorite ?? 0))

  const calledItems = allItems
    .filter((i) => i.called_at)
    .sort((a, b) => {
      // Tri par called_at ASC — les premiers appels en haut de l'historique
      if (!a.called_at || !b.called_at) return 0
      return new Date(a.called_at).getTime() - new Date(b.called_at).getTime()
    })

  // items = non-appelés (top 15 par score) puis appelés (historique)
  const items: (DailyListItem & { prospect: Prospect })[] = [...uncalledItems, ...calledItems]

  const calledCount = calledItems.length
  const totalCount = items.length
  const progressPercent = totalCount > 0 ? (calledCount / totalCount) * 100 : 0

  // Statut de la liste pour le badge — dailyList est déjà DailyList | null
  const listStatus = dailyList?.status ?? null

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
        {dailyList && listStatus && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              <span className="font-semibold text-gray-900 dark:text-white">{calledCount}</span>
              /{totalCount} appels
            </span>
            <StatusBadge status={listStatus} />
          </div>
        )}
      </div>

      {/* ── Barre de progression ─────────────────────────────── */}
      {dailyList && totalCount > 0 && (
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
              aria-valuemax={totalCount}
            />
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-400 dark:text-gray-600">
            <span>{calledCount} effectués</span>
            <span>{uncalledItems.length} restants</span>
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
      {listStatus === 'generating' && totalCount === 0 && (
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
