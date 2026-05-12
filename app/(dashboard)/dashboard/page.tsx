import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { AgentRun, DailyList, DailyListItem, Prospect } from '@/lib/types'
import { GenerateListButton } from '@/components/dashboard/generate-list-button'
import { RunStatusBanner } from '@/components/dashboard/run-status-banner'

// Force le rendu dynamique à chaque requête — interdit tout cache SSR stale
// qui afficherait un ancien run échoué même après un run réussi plus récent.
export const dynamic = 'force-dynamic'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(isoString: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(isoString))
}

function formatDateLong(isoString: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(
    new Date(isoString)
  )
}

function formatDayOfWeek(isoString: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(
    new Date(isoString)
  )
}

// ── Sous-composants ──────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  max,
  color,
  icon,
}: {
  label: string
  value: number
  max?: number
  color: 'green' | 'blue' | 'yellow' | 'purple'
  icon: React.ReactNode
}) {
  const colorConfig = {
    green: {
      card: 'border-green-100 dark:border-green-900/40',
      icon: 'bg-green-100 text-green-600 dark:bg-green-950/60 dark:text-green-400',
      value: 'text-green-700 dark:text-green-400',
      progress: 'bg-green-500',
      progressBg: 'bg-green-100 dark:bg-green-950/40',
    },
    blue: {
      card: 'border-blue-100 dark:border-blue-900/40',
      icon: 'bg-blue-100 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400',
      value: 'text-blue-700 dark:text-blue-400',
      progress: 'bg-blue-500',
      progressBg: 'bg-blue-100 dark:bg-blue-950/40',
    },
    yellow: {
      card: 'border-yellow-100 dark:border-yellow-900/40',
      icon: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-950/60 dark:text-yellow-400',
      value: 'text-yellow-700 dark:text-yellow-400',
      progress: 'bg-yellow-500',
      progressBg: 'bg-yellow-100 dark:bg-yellow-950/40',
    },
    purple: {
      card: 'border-purple-100 dark:border-purple-900/40',
      icon: 'bg-purple-100 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400',
      value: 'text-purple-700 dark:text-purple-400',
      progress: 'bg-purple-500',
      progressBg: 'bg-purple-100 dark:bg-purple-950/40',
    },
  }

  const cfg = colorConfig[color]
  const progressPercent = max !== undefined && max > 0 ? Math.min((value / max) * 100, 100) : 0

  return (
    <div className={`rounded-xl border bg-white p-5 dark:bg-gray-900 ${cfg.card} shadow-sm`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {label}
          </p>
          <p className={`mt-2 text-3xl font-bold tabular-nums leading-none ${cfg.value}`}>
            {value}
            {max !== undefined && (
              <span className="ml-1 text-base font-normal text-gray-400 dark:text-gray-600">
                /{max}
              </span>
            )}
          </p>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${cfg.icon}`}>
          {icon}
        </span>
      </div>

      {max !== undefined && max > 0 && (
        <div className="mt-4">
          <div className={`h-1.5 w-full overflow-hidden rounded-full ${cfg.progressBg}`}>
            <div
              className={`h-full rounded-full transition-all duration-500 ${cfg.progress}`}
              style={{ width: `${progressPercent}%` }}
              role="progressbar"
              aria-valuenow={value}
              aria-valuemin={0}
              aria-valuemax={max}
            />
          </div>
          <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-600">
            {progressPercent.toFixed(0)}% complété
          </p>
        </div>
      )}
    </div>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    haute: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-900',
    normale: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-400 ring-1 ring-yellow-200 dark:ring-yellow-900',
    basse: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 ring-1 ring-gray-200 dark:ring-gray-700',
  }
  const label: Record<string, string> = {
    haute: 'Haute',
    normale: 'Normale',
    basse: 'Basse',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[priority] ?? map['normale']}`}>
      {label[priority] ?? priority}
    </span>
  )
}

// ── Icônes des métriques ─────────────────────────────────────────────────────

function IconPhone() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.5 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.27 5.27l1.17-1.17a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.28 15l.64 1.92z" />
    </svg>
  )
}

function IconCheckCircle() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

function IconStar() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

// ── Statut agent : timeline ───────────────────────────────────────────────────

function AgentPhaseTimeline({ agentRun }: { agentRun: AgentRun }) {
  const phases = [
    { key: 'init', label: 'Initialisation' },
    { key: 'sourcing', label: 'Sourcing' },
    { key: 'scoring', label: 'Scoring' },
    { key: 'selection', label: 'Sélection' },
    { key: 'pitchs', label: 'Pitchs IA' },
    { key: 'finalization', label: 'Finalisation' },
  ]

  const currentPhaseIndex = phases.findIndex((p) => agentRun.phase?.includes(p.key))
  const effectiveIndex = currentPhaseIndex === -1
    ? (agentRun.status === 'completed' ? phases.length - 1 : 0)
    : currentPhaseIndex

  return (
    <div className="mt-4 flex items-center gap-1" role="list" aria-label="Phases de l'agent">
      {phases.map((phase, idx) => {
        const isCompleted = agentRun.status === 'completed' || idx < effectiveIndex
        const isCurrent = agentRun.status === 'running' && idx === effectiveIndex
        return (
          <div key={phase.key} className="flex flex-1 flex-col items-center" role="listitem">
            <div
              className={`h-2 w-full rounded-full transition-all duration-300 ${
                isCompleted
                  ? 'bg-green-500'
                  : isCurrent
                  ? 'bg-yellow-400 animate-pulse'
                  : 'bg-gray-200 dark:bg-gray-700'
              }`}
              title={phase.label}
              aria-label={`${phase.label} : ${isCompleted ? 'terminé' : isCurrent ? 'en cours' : 'en attente'}`}
            />
            <span className="mt-1 hidden text-[10px] text-gray-400 dark:text-gray-600 sm:block">
              {phase.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Page principale ──────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Une seule instance de Date — évite le bug "à minuit" si deux new Date() donnent des jours différents
  const nowDate = new Date()
  const today = nowDate.toISOString().split('T')[0]

  // Récupération parallèle de toutes les données
  const [agentRunResult, dailyListResult, profileResult] = await Promise.all([
    supabase
      .from('agent_runs')
      .select('id, user_id, status, phase, prospects_sourced, prospects_qualified, list_generated, error_message, started_at, completed_at')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .maybeSingle(),
    supabase
      .from('daily_lists')
      .select(`
        id, user_id, date, status, generated_at, created_at,
        items:daily_list_items(
          id, ordre, priorite, called_at, call_result,
          prospect:prospects(id, raison_sociale, secteur_libelle, ville, statut)
        )
      `)
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', user.id)
      // maybeSingle() au lieu de single() : single() lève une erreur PGRST116
      // si le profil n'existe pas encore (état transitoire juste après inscription)
      // ou si la RLS bloque la row — dans les deux cas profileResult.data vaudrait
      // null et le fallback "Utilisateur" s'appliquait à tort.
      .maybeSingle(),
  ])

  const agentRun = agentRunResult.data as AgentRun | null
  const dailyList = dailyListResult.data as (DailyList & { items: (DailyListItem & { prospect: Prospect })[] }) | null
  // Fallback sur user_metadata.full_name (Supabase Auth) si profiles.full_name est null.
  // C'est la même source que le trigger handle_new_user utilise à l'inscription.
  const profileData = profileResult.data as { full_name: string | null; email: string | null } | null
  const metaFullName = (user.user_metadata?.full_name as string | null | undefined) ?? null

  // Calcul métriques
  const items = dailyList?.items ?? []
  const totalPrepared = items.length
  const totalCalled = items.filter((i) => i.called_at).length
  const totalInterested = items.filter((i) => i.call_result === 'interested').length
  const totalRdv = items.filter((i) => i.call_result === 'interested' && i.prospect?.statut === 'rdv').length

  // 3 prochains appels non effectués — triés par score_priorite DESC (meilleurs en premier)
  // prospect peut être null si la relation n'est pas résolue (sécurité : fallback 0)
  const nextCalls = items
    .filter((i) => !i.called_at)
    .sort((a, b) => (b.prospect?.score_priorite ?? 0) - (a.prospect?.score_priorite ?? 0))
    .slice(0, 3)

  const dailyTarget = 15

  const todayIso = nowDate.toISOString()
  const rawFirstName =
    profileData?.full_name?.split(' ')[0] ??
    metaFullName?.split(' ')[0] ??
    profileData?.email?.split('@')[0] ??
    user.email?.split('@')[0] ??
    'Utilisateur'
  const firstName =
    rawFirstName.charAt(0).toUpperCase() + rawFirstName.slice(1).toLowerCase()

  return (
    <div className="mx-auto max-w-5xl space-y-6">

      {/* ── Section bienvenue ─────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Bonjour, {firstName}
          </h1>
          <p className="mt-0.5 text-sm capitalize text-gray-500 dark:text-gray-400">
            {formatDayOfWeek(todayIso)}{' '}
            <span className="normal-case">{formatDateLong(todayIso)}</span>
          </p>
        </div>
        {/* Capsule résumé rapide */}
        {totalPrepared > 0 && (
          <div className="flex items-center gap-2 rounded-full bg-green-50 px-4 py-1.5 text-sm font-medium text-green-700 ring-1 ring-green-200 dark:bg-green-950/30 dark:text-green-400 dark:ring-green-900">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
            {totalCalled}/{totalPrepared} appels effectués
          </div>
        )}
      </div>

      {/* ── Bandeau live run agent ────────────────────────────── */}
      {/* Affiche un statut temps-réel tant qu'un run est en cours.
          Disparait sinon (sauf toast de fin pendant quelques secondes). */}
      <RunStatusBanner />

      {/* ── Métriques du jour ─────────────────────────────────── */}
      <section aria-labelledby="metrics-title">
        <h2
          id="metrics-title"
          className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-600"
        >
          Métriques du jour
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard
            label="Appels préparés"
            value={totalPrepared}
            max={totalPrepared > 0 ? totalPrepared : dailyTarget}
            color="blue"
            icon={<IconPhone />}
          />
          <MetricCard
            label="Appelés"
            value={totalCalled}
            max={totalPrepared || dailyTarget}
            color="yellow"
            icon={<IconCheckCircle />}
          />
          <MetricCard
            label="Intéressés"
            value={totalInterested}
            max={totalCalled || undefined}
            color="green"
            icon={<IconStar />}
          />
          <MetricCard
            label="RDV pris"
            value={totalRdv}
            color="purple"
            icon={<IconCalendar />}
          />
        </div>
      </section>

      {/* ── Statut dernier run agent ──────────────────────────── */}
      <section
        aria-labelledby="agent-status-title"
        className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800/60 dark:bg-gray-900"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="agent-status-title"
            className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-600"
          >
            Dernier run de l&apos;agent
          </h2>

          {agentRun && (
            <div>
              {agentRun.status === 'completed' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 dark:bg-green-950/60 dark:text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
                  Terminé
                </span>
              )}
              {agentRun.status === 'running' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-700 dark:bg-yellow-950/60 dark:text-yellow-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" aria-hidden="true" />
                  En cours
                </span>
              )}
              {agentRun.status === 'failed' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-950/60 dark:text-red-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />
                  Échoué
                </span>
              )}
            </div>
          )}
        </div>

        {agentRun ? (
          <>
            {/* Timeline phases */}
            <AgentPhaseTimeline agentRun={agentRun} />

            {/* Infos textuelles */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/50">
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-600">
                  Lancé
                </p>
                <p className="mt-0.5 text-sm font-semibold text-gray-900 dark:text-white">
                  {formatDateTime(agentRun.started_at)}
                </p>
              </div>
              {agentRun.completed_at && (
                <div className="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/50">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-600">
                    Terminé
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-gray-900 dark:text-white">
                    {formatDateTime(agentRun.completed_at)}
                  </p>
                </div>
              )}
              <div className="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/50">
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-600">
                  Sourcés
                </p>
                <p className="mt-0.5 text-sm font-semibold text-gray-900 dark:text-white">
                  {agentRun.prospects_sourced}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/50">
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-600">
                  Qualifiés
                </p>
                <p className="mt-0.5 text-sm font-semibold text-gray-900 dark:text-white">
                  {agentRun.prospects_qualified}
                </p>
              </div>
            </div>

            {agentRun.error_message && (
              <div
                className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 dark:bg-red-950/30"
                role="alert"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0 text-red-600 dark:text-red-400" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p className="text-sm text-red-700 dark:text-red-400">
                  {agentRun.error_message}
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="mt-4 flex items-center gap-3 rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-800/30">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-gray-400" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Aucun run effectué. Lancez l&apos;agent depuis le bouton en haut à droite.
            </p>
          </div>
        )}
      </section>

      {/* ── Prochains appels ──────────────────────────────────── */}
      {nextCalls.length > 0 && (
        <section aria-labelledby="next-calls-title">
          <div className="mb-3 flex items-center justify-between">
            <h2
              id="next-calls-title"
              className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-600"
            >
              Prochains appels
            </h2>
            <Link
              href="/daily-list"
              className="group inline-flex items-center gap-1 text-xs font-medium text-green-600 transition-colors hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
            >
              Voir tous
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          </div>

          <div className="space-y-2.5">
            {nextCalls.map((item, index) => (
              <Link
                key={item.id}
                href="/daily-list"
                className="group flex items-center gap-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-all duration-150 hover:border-green-200 hover:shadow-md dark:border-gray-800/60 dark:bg-gray-900 dark:hover:border-green-900"
              >
                {/* Numéro badge */}
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {index + 1}
                </span>

                {/* Contenu */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-semibold text-gray-900 dark:text-white">
                      {item.prospect?.raison_sociale ?? 'Entreprise inconnue'}
                    </p>
                    <PriorityBadge priority={item.priorite} />
                  </div>
                  <p className="mt-0.5 truncate text-sm text-gray-400 dark:text-gray-500">
                    {item.prospect?.secteur_libelle ?? '—'}
                    {item.prospect?.ville ? ` · ${item.prospect.ville}` : ''}
                  </p>
                </div>

                {/* Flèche */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="flex-shrink-0 text-gray-300 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-green-500 dark:text-gray-700 dark:group-hover:text-green-500"
                  aria-hidden="true"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── CTA Générer la liste ─────────────────────────────── */}
      <section
        aria-labelledby="generate-title"
        className="rounded-xl border border-green-100 bg-gradient-to-br from-green-50 to-white p-5 shadow-sm dark:border-green-900/40 dark:from-green-950/20 dark:to-gray-900"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-green-100 text-green-600 dark:bg-green-950/60 dark:text-green-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <div>
              <h2 id="generate-title" className="font-semibold text-gray-900 dark:text-white">
                Liste de demain
              </h2>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                Déclenchez manuellement la génération de vos{' '}
                {dailyTarget} appels pour demain.
              </p>
            </div>
          </div>
          <GenerateListButton
            hasExistingList={dailyList !== null}
            listItemCount={totalPrepared}
            dailyTarget={dailyTarget}
          />
        </div>
      </section>

      {/* ── État vide (aucune liste aujourd'hui) ────────────── */}
      {dailyList === null && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white py-14 text-center dark:border-gray-800 dark:bg-gray-900/50">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 dark:text-gray-600" aria-hidden="true">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.5 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.27 5.27l1.17-1.17a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.28 15l.64 1.92z" />
            </svg>
          </div>
          <p className="mt-4 text-sm font-medium text-gray-600 dark:text-gray-400">
            Aucune liste générée pour aujourd&apos;hui
          </p>
          <p className="mt-1 text-sm text-gray-400 dark:text-gray-600">
            Lancez l&apos;agent pour préparer vos {dailyTarget} appels du jour.
          </p>
        </div>
      )}
    </div>
  )
}
