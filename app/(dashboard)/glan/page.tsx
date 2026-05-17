// ============================================================
// /glan — Page dédiée à l'agent Glan
//
// Contenu :
//   - GlanAvatar grande taille + état courant
//   - QuotaWidget du mois en cours
//   - Section « Comment je travaille » (5 phases)
//   - Section « Pipeline mensuel »
//   - Section « Pipelines automatisés »
//   - Section « Garanties »
//   - GlanTimeline du run le plus récent
//   - GlanLogStream complet (avec scroll)
//   - Historique des derniers runs (cartes)
//
// Le déclenchement d'un run se fait via le bouton « Lancer Glan »
// du header global (components/layout/dashboard-header.tsx), qui ouvre
// la SourcingModal — l'unique entry point officiel du pipeline.
// ============================================================

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { GlanPortrait } from '@/components/glan/glan-portrait'
import { GlanTimeline } from '@/components/glan/glan-timeline'
import { GlanLogStream } from '@/components/glan/glan-log-stream'
import { QuotaWidget } from '@/components/glan/quota-widget'
import { GlassCard } from '@/components/ui/glass-card'
import { EmptyState } from '@/components/ui/empty-state'
import { getAllQuotas, QUOTA_LIMITS, QUOTA_PROVIDERS } from '@/lib/agent/quotas'
import type { AgentRun } from '@/lib/types'

export const metadata = {
  title: 'Glan — Activité',
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.floor(ms / 60_000)
  const sec = Math.floor((ms % 60_000) / 1000)
  return `${min}m ${sec}s`
}

const STATUS_TONE: Record<string, string> = {
  running: 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/25',
  completed: 'bg-green-500/15 text-green-200 ring-1 ring-green-500/25',
  failed: 'bg-red-500/15 text-red-200 ring-1 ring-red-500/25',
}

const STATUS_LABEL: Record<string, string> = {
  running: 'En cours',
  completed: 'Terminé',
  failed: 'Échoué',
}

// ── Données des 5 phases ──────────────────────────────────────────────────────

const HOW_PHASES = [
  {
    tag: 'INSEE Sirene',
    tagClass: 'bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-500/20',
    title: 'Sourcing Sirene',
    description:
      "J'interroge la base Sirene de l'INSEE selon vos critères : code NAF rév. 2, tranche d'effectif, zone géographique. Je remonte les entreprises potentiellement concernées par BEGES.",
  },
  {
    tag: 'Registre ADEME',
    tagClass: 'bg-violet-500/10 text-violet-300 ring-1 ring-violet-500/20',
    title: 'Croisement BEGES ADEME',
    description:
      "Pour chaque entreprise sourcée, je consulte le registre officiel ADEME : statut de publication, validité, année de référence. C'est le signal réglementaire principal.",
  },
  {
    tag: 'NAF rév. 2 + IA',
    tagClass: 'bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/20',
    title: 'Catégorisation secteur (NAF)',
    description:
      "Je résous le libellé secteur officiel à partir du code NAF rév. 2 INSEE. Si l'INSEE est indisponible, je passe en fallback IA pour ne jamais bloquer une qualification commerciale.",
  },
  {
    tag: '3 piliers lisibles',
    tagClass: 'bg-green-500/10 text-green-300 ring-1 ring-green-500/20',
    title: 'Scoring 0-100, 3 piliers',
    description:
      'Je calcule un score sur trois piliers transparents : taille (effectif, ancienneté), BEGES (publié, valide, expiré), contact (email pro, dirigeant). Pondérations paramétrables.',
  },
  {
    tag: 'Pappers + Hunter',
    tagClass: 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20',
    title: 'Enrichissement contacts',
    description:
      "Pour les prospects prioritaires (score le plus élevé), j'enrichis téléphone via Pappers et email pro via Hunter.io. Les autres restent en COLD, à requalifier au prochain run.",
  },
] as const

export default async function GlanPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: rawRuns } = await supabase
    .from('agent_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(10)

  const runs = (rawRuns ?? []) as unknown as AgentRun[]
  const lastRun = runs[0] ?? null
  const isRunning = lastRun?.status === 'running'

  // Quotas API du mois (Pappers / Hunter / INPI / Google CSE) — getAllQuotas
  // crée les lignes manquantes via upsert (jamais d'exception), donc on récupère
  // toujours 4 entrées même pour un user qui n'a jamais lancé d'enrichissement.
  // Mode dégradé en cas d'erreur DB : on rend 4 quotas neutres à 0 (toujours
  // 4 cellules visibles, jamais de section vide à l'écran).
  let quotas: Awaited<ReturnType<typeof getAllQuotas>>
  try {
    quotas = await getAllQuotas(supabase, user.id)
  } catch {
    quotas = []
  }

  if (quotas.length === 0) {
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    quotas = QUOTA_PROVIDERS.map((provider) => ({
      provider,
      used: 0,
      remaining: QUOTA_LIMITS[provider],
      limit: QUOTA_LIMITS[provider],
      monthStart,
      exhausted: false,
    }))
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* ── En-tête ──────────────────────────────────────────────────── */}
      <header className="flex flex-col items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md p-8 text-center shadow-sm sm:flex-row sm:text-left">
        <GlanPortrait
          state={
            isRunning
              ? 'working'
              : lastRun?.status === 'failed'
                ? 'error'
                : lastRun?.status === 'completed'
                  ? 'done'
                  : 'dormant'
          }
          size={320}
          className="flex-shrink-0"
        />
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Glan
            </h1>
            <p className="text-sm text-gray-300">
              Votre agent de sourcing BEGES. Quand vous me lancez, je glane
              Sirene et l&apos;ADEME pour identifier les entreprises soumises à
              l&apos;article L. 229-25, je les score sur trois piliers,
              j&apos;enrichis les contacts prioritaires. Je prépare le terrain,
              vous appelez. Sources publiques uniquement.
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-green-400/80">
              — Glan
            </p>
          </div>
        </div>
      </header>

      {/* ── Quotas API d'enrichissement — mois en cours ─────────────── */}
      <QuotaWidget quotas={quotas} />

      {/* ── Section : Comment je travaille (5 phases) ─────────────────── */}
      <section className="space-y-5">
        <div className="space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
            Comment je travaille
          </p>
          <h2 className="text-xl font-bold tracking-tight text-white">
            Cinq phases, chaque fois que vous me lancez
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-gray-400">
            Chaque run suit la même séquence, déterministe et auditable. Pas
            de boîte noire : chaque phase produit un signal lisible dans le
            journal d&apos;exécution, source par source, prospect par prospect.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {HOW_PHASES.map((phase) => (
            <div
              key={phase.title}
              className="relative rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 backdrop-blur-md before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent"
            >
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${phase.tagClass}`}
              >
                {phase.tag}
              </span>
              <h3 className="mt-3 text-sm font-bold text-white">
                {phase.title}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
                {phase.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section : Pipeline mensuel ────────────────────────────────── */}
      <section>
        <div className="relative overflow-hidden rounded-2xl border border-amber-500/15 bg-white/[0.025] p-6 backdrop-blur-md before:absolute before:inset-x-8 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-amber-400/40 before:to-transparent">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-400/80">
            Pipeline mensuel
          </p>
          <h2 className="mt-1 text-lg font-bold tracking-tight text-white">
            Une base technique fraîche, le premier de chaque mois
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-400">
            Le premier de chaque mois à 04:00, je rafraîchis automatiquement
            ma base technique avec le dernier registre officiel INSEE. Plus de
            41 millions d&apos;établissements parcourus, filtrés selon les secteurs
            prioritaires de l&apos;article L. 229-25 (effectif ≥ 10, industrie,
            énergie, transport, agriculture, construction). Aucune action de
            votre part.
          </p>
        </div>
      </section>

      {/* ── Section : Pipelines automatisés ──────────────────────────── */}
      <section>
        <GlassCard>
          <h2 className="mb-4 text-base font-bold tracking-tight text-white">
            Pipelines automatisés, hygiène et conformité
          </h2>
          <ul className="space-y-3">
            <li className="flex items-start gap-3 text-sm text-gray-300">
              {/* Icône horloge */}
              <svg
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-cyan-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Nettoyage quotidien des runs interrompus (<code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[11px] text-gray-300">reap-stale</code>, 04:00) pour relancer sereinement.
            </li>
            <li className="flex items-start gap-3 text-sm text-gray-300">
              {/* Icône loupe */}
              <svg
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-violet-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Surveillance hebdomadaire BODACC le lundi : changements de dirigeants signalés sur vos contacts.
            </li>
            <li className="flex items-start gap-3 text-sm text-gray-300">
              {/* Icône corbeille */}
              <svg
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
                aria-hidden="true"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4h6v2" />
              </svg>
              Purge RGPD quotidienne à 03:00 : prospects de plus de 3 ans supprimés, durée alignée CNIL.
            </li>
          </ul>
        </GlassCard>
      </section>

      {/* ── Section : Garanties ──────────────────────────────────────── */}
      <section>
        <GlassCard>
          <h2 className="mb-4 text-base font-bold tracking-tight text-white">
            Garanties : sobriété, conformité, isolation
          </h2>
          <ul className="space-y-3">
            {[
              'Sources publiques uniquement : Sirene, ADEME, INPI, BODACC. Aucun scraping, aucun fichier.',
              "Isolation par compte : Row Level Security Supabase, vos données ne croisent jamais d'autres.",
              'Conformité RGPD CNIL : purge automatique à 3 ans, opt-out respecté absolument.',
              "Pas d'écriture en votre nom : ni email, ni LinkedIn. Je prépare le terrain, vous appelez.",
            ].map((puce) => (
              <li key={puce} className="flex items-start gap-3 text-sm text-gray-300">
                <svg
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {puce}
              </li>
            ))}
          </ul>
        </GlassCard>
      </section>

      {/* ── Run le plus récent ────────────────────────────────────────── */}
      {lastRun ? (
        <GlassCard variant="elevated" className="space-y-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
                {'// Dernier run'}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-white">
                {formatDateTime(lastRun.started_at)}
              </h2>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[lastRun.status] ?? STATUS_TONE.completed}`}
            >
              {STATUS_LABEL[lastRun.status] ?? lastRun.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Sourcés" value={lastRun.prospects_sourced ?? 0} />
            <Stat label="Qualifiés" value={lastRun.prospects_qualified ?? 0} />
            <Stat
              label="Durée"
              value={formatDuration(
                lastRun.completed_at
                  ? new Date(lastRun.completed_at).getTime() -
                      new Date(lastRun.started_at).getTime()
                  : null,
              )}
            />
            <Stat
              label="Liste"
              value={lastRun.list_generated ? 'Générée' : '—'}
            />
          </div>

          {/* Timeline + Logs côte à côte */}
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
                {'// Phases'}
              </p>
              <GlanTimeline run={lastRun} />
            </div>
            <div>
              <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
                {'// Logs'}
              </p>
              <GlanLogStream
                logs={Array.isArray(lastRun.logs) ? lastRun.logs : []}
                maxHeight="22rem"
              />
            </div>
          </div>
        </GlassCard>
      ) : (
        <GlassCard>
          <EmptyState
            variant="agent-idle"
            title="Aucun run pour l'instant"
            description="Je n'ai pas encore glané pour vous. Lancez votre premier run depuis le bouton ci-dessus : je parcours Sirene et l'ADEME, je vous livre une liste priorisée."
          />
        </GlassCard>
      )}

      {/* ── Historique des runs précédents ────────────────────────────── */}
      {runs.length > 1 && (
        <section>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-400/80">
            {'// Historique récent'}
          </h2>
          <ol className="space-y-2">
            {runs.slice(1).map((run) => {
              const duration = run.completed_at
                ? new Date(run.completed_at).getTime() -
                  new Date(run.started_at).getTime()
                : null
              return (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md px-4 py-3"
                >
                  <div className="flex items-baseline gap-3">
                    <p className="font-mono text-sm tabular-nums text-white">
                      {formatDateTime(run.started_at)}
                    </p>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[run.status] ?? STATUS_TONE.completed}`}
                    >
                      {STATUS_LABEL[run.status] ?? run.status}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-4 text-xs text-gray-400">
                    <span>
                      <span className="font-medium text-gray-200">
                        {run.prospects_sourced ?? 0}
                      </span>{' '}
                      sourcés
                    </span>
                    <span>
                      <span className="font-medium text-gray-200">
                        {run.prospects_qualified ?? 0}
                      </span>{' '}
                      qualifiés
                    </span>
                    <span className="font-mono text-gray-400">{formatDuration(duration)}</span>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-white">
        {value}
      </p>
    </div>
  )
}
