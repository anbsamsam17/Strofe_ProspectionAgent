'use client'

// ============================================================
// Widget : Cache SIRENE — état & déclenchement import
// ------------------------------------------------------------
// Affiche le statut du cache local SIRENE (table `sirene_cache`) :
//   - Nombre d'établissements actifs en cache
//   - Taille DB (utilisée / max) et marge avant saturation
//   - Date du dernier import et delta en jours
//   - Badge de fraîcheur (fresh / aging / stale / empty)
//   - Bouton "Re-importer" qui n'exécute PAS l'ETL (Vercel timeout 800s
//     insuffisant pour 15-30 min d'import bulk) — affiche une commande
//     CLI à copier-coller (GitHub Actions ou `npm run import-sirene`).
//
// Pattern fetch :
//   - GET /api/admin/sirene-status (session user, pas CRON_SECRET — la
//     route s'authentifie via session Supabase SSR côté serveur).
//   - Polling 30s pour rafraîchir le statut (utile en cours d'import).
//
// Conventions :
//   - Tailwind v4 brut, glass dark : bg-white/[0.03] backdrop-blur-md.
//   - Label mono cyan, aligné avec le reste du tableau de bord Glan.
//   - A11y : `role="status"` + `aria-live="polite"` sur le badge.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'

// ── Constantes ────────────────────────────────────────────────────────────

/** Délai de polling pour rafraîchir le status (ms). 30s suffit pour suivre un import. */
const POLLING_INTERVAL_MS = 30_000

/** Cap freshness : moins de 30 jours = vert (« frais »). */
const FRESHNESS_FRESH_DAYS = 30

/** Cap freshness : 30-60 jours = ambre (« vieillissant »). */
const FRESHNESS_AGING_DAYS = 60

/** Commande GitHub Actions à copier-coller pour relancer l'ETL. */
const TRIGGER_COMMAND = 'gh workflow run sirene-import.yml -f force=true'

/** Limite storage configurée pour la table `sirene_cache` (MB) — affichage indicatif. */
const SIRENE_CACHE_MAX_MB = 100

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Niveau de fraîcheur calculé côté API à partir de `days_since_import`.
 * `empty` = pas d'import du tout (cache vide).
 */
type Freshness = 'fresh' | 'aging' | 'stale' | 'empty'

/**
 * Payload renvoyé par GET /api/admin/sirene-status.
 * Aligné avec la vue `sirene_cache_size` étendue (active_count, last_import_at).
 */
interface SireneStatus {
  /** Nombre d'établissements actifs en cache (etat_administratif = 'A'). */
  active_count: number
  /** Taille humaine de la table (table + index + TOAST). Ex: "78 MB". */
  total_size: string
  /** Taille brute en octets (sert au calcul du pourcentage de remplissage). */
  total_bytes: number
  /** Jours écoulés depuis le dernier import. `null` si cache vide. */
  days_since_import: number | null
  /** Date du dernier import (ISO 8601). `null` si cache vide. */
  last_import_at: string | null
  /** Indicateur dérivé côté serveur — économise un calcul côté UI. */
  freshness: Freshness
  /** True si la table est vide. Permet d'adapter le CTA. */
  is_empty: boolean
}

interface ApiResponse {
  data?: SireneStatus
  error?: { code: string; message: string }
}

// ── Helpers d'affichage ───────────────────────────────────────────────────

/**
 * Formate une date ISO en français long ("14 mai 2026 (3 jours)").
 * Renvoie une chaîne vide si la date est invalide.
 */
function formatLastImport(iso: string | null, daysSince: number | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const dateFr = date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  if (daysSince === null) return dateFr
  if (daysSince === 0) return `${dateFr} (aujourd'hui)`
  if (daysSince === 1) return `${dateFr} (hier)`
  return `${dateFr} (${daysSince} jours)`
}

/**
 * Calcule la date estimée du prochain refresh mensuel.
 * Le workflow GitHub Actions tourne le 1er de chaque mois.
 */
function formatNextRefresh(): string {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return next.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** Mapping freshness → classes Tailwind du badge. */
function freshnessBadgeClasses(freshness: Freshness): string {
  switch (freshness) {
    case 'fresh':
      return 'bg-green-500/15 text-green-300 ring-1 ring-green-500/25'
    case 'aging':
      return 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25'
    case 'stale':
      return 'bg-red-500/15 text-red-300 ring-1 ring-red-500/25'
    case 'empty':
      return 'bg-gray-500/15 text-gray-300 ring-1 ring-gray-500/25'
  }
}

/** Libellé court du badge. */
function freshnessLabel(freshness: Freshness): string {
  switch (freshness) {
    case 'fresh':
      return 'Frais'
    case 'aging':
      return 'Vieillissant'
    case 'stale':
      return 'Obsolète'
    case 'empty':
      return 'Vide'
  }
}

/**
 * Fallback côté UI si l'API ne renvoie pas `freshness`. Cohérent avec les
 * caps `FRESHNESS_FRESH_DAYS` / `FRESHNESS_AGING_DAYS`.
 */
function deriveFreshness(daysSince: number | null, isEmpty: boolean): Freshness {
  if (isEmpty || daysSince === null) return 'empty'
  if (daysSince < FRESHNESS_FRESH_DAYS) return 'fresh'
  if (daysSince < FRESHNESS_AGING_DAYS) return 'aging'
  return 'stale'
}

// ── Composant principal ──────────────────────────────────────────────────

export function SireneCacheStatus() {
  const [status, setStatus] = useState<SireneStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  // Ref pour annuler les requêtes en cours quand le composant démonte ou
  // qu'un polling tick déclenche une nouvelle requête avant la précédente.
  const abortRef = useRef<AbortController | null>(null)

  const fetchStatus = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/admin/sirene-status', {
        method: 'GET',
        signal: controller.signal,
      })
      const payload = (await res.json().catch(() => ({}))) as ApiResponse
      if (!res.ok || !payload.data) {
        throw new Error(payload.error?.message ?? `Erreur ${res.status}`)
      }
      const data = payload.data
      // Sécurise : si l'API n'envoie pas `freshness`, on le dérive.
      const freshness: Freshness = data.freshness ?? deriveFreshness(
        data.days_since_import,
        data.is_empty,
      )
      setStatus({ ...data, freshness })
      setError(null)
    } catch (err) {
      // AbortError n'est pas une vraie erreur — c'est juste un cleanup.
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Premier chargement + polling 30s.
  useEffect(() => {
    fetchStatus()
    const interval = window.setInterval(fetchStatus, POLLING_INTERVAL_MS)
    return () => {
      window.clearInterval(interval)
      abortRef.current?.abort()
    }
  }, [fetchStatus])

  return (
    <section
      aria-labelledby="sirene-cache-title"
      className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm"
    >
      <header className="border-b border-white/[0.06] px-6 py-5">
        <h2
          id="sirene-cache-title"
          className="font-mono text-xs font-semibold uppercase tracking-widest text-cyan-300"
        >
          {'// CACHE SIRENE · ÉTAT'}
        </h2>
        <p className="mt-1 text-sm text-gray-300">
          Miroir local du registre INSEE — base du sourcing nocturne.
        </p>
      </header>

      <div className="px-6 py-6">
        {isLoading && !status ? (
          <SkeletonBlock />
        ) : error ? (
          <ErrorBlock message={error} onRetry={fetchStatus} />
        ) : status ? (
          <StatusBlock
            status={status}
            onTrigger={() => setIsDialogOpen(true)}
          />
        ) : null}
      </div>

      {isDialogOpen && (
        <TriggerDialog
          isEmpty={status?.is_empty ?? false}
          onClose={() => setIsDialogOpen(false)}
        />
      )}
    </section>
  )
}

// ── Sous-composants ──────────────────────────────────────────────────────

interface StatusBlockProps {
  status: SireneStatus
  onTrigger: () => void
}

function StatusBlock({ status, onTrigger }: StatusBlockProps) {
  const sizeMb = Math.round((status.total_bytes / (1024 * 1024)) * 10) / 10
  const fillRatio = Math.min(1, sizeMb / SIRENE_CACHE_MAX_MB)
  const fillPct = Math.round(fillRatio * 100)

  // Barre de remplissage : passe en ambre > 75 %, rouge > 90 %.
  const fillBarClass =
    fillRatio >= 0.9
      ? 'bg-red-400'
      : fillRatio >= 0.75
        ? 'bg-amber-400'
        : 'bg-green-400'

  return (
    <div className="space-y-5">
      {/* Bandeau alertes (stale / empty) */}
      {status.freshness === 'stale' && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3.5 py-2.5 text-sm text-red-200"
        >
          Cache obsolète, lancer un import.
        </div>
      )}
      {status.is_empty && (
        <div
          role="alert"
          className="rounded-lg border border-gray-500/30 bg-gray-500/[0.08] px-3.5 py-2.5 text-sm text-gray-200"
        >
          Cache vide, lancer l&apos;import initial.
        </div>
      )}

      {/* Métriques */}
      <dl className="space-y-3 text-sm">
        <Row label="Entreprises en cache">
          <span className="font-semibold tabular-nums text-white">
            {status.active_count.toLocaleString('fr-FR')}
          </span>
        </Row>

        <Row label="Taille DB">
          <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="font-semibold tabular-nums text-white">
              {status.total_size} / {SIRENE_CACHE_MAX_MB} MB max
            </span>
            <div
              className="h-1.5 w-24 overflow-hidden rounded-full bg-white/[0.06]"
              aria-hidden="true"
            >
              <div
                className={`h-full ${fillBarClass} transition-all`}
                style={{ width: `${fillPct}%` }}
              />
            </div>
          </div>
        </Row>

        <Row label="Dernière mise à jour">
          <span className="tabular-nums text-gray-200">
            {formatLastImport(status.last_import_at, status.days_since_import)}
          </span>
        </Row>

        <Row label="Fraîcheur">
          <span
            role="status"
            aria-live="polite"
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${freshnessBadgeClasses(status.freshness)}`}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-current"
              aria-hidden="true"
            />
            {freshnessLabel(status.freshness)}
          </span>
        </Row>
      </dl>

      {/* CTA Re-importer */}
      <div className="border-t border-white/[0.06] pt-5">
        <button
          type="button"
          onClick={onTrigger}
          className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/[0.08] px-3.5 py-2 text-sm font-medium text-cyan-200 transition hover:border-cyan-400/50 hover:bg-cyan-500/[0.14] hover:text-cyan-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
        >
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
            aria-hidden="true"
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          {status.is_empty ? "Lancer l'import initial" : 'Re-importer maintenant'}
        </button>

        <p className="mt-3 text-xs text-gray-400">
          Prochain refresh auto :{' '}
          <span className="font-medium text-gray-300">{formatNextRefresh()}</span>{' '}
          (mensuel, GitHub Actions).
        </p>
      </div>
    </div>
  )
}

interface RowProps {
  label: string
  children: React.ReactNode
}

function Row({ label, children }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-gray-400">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

// ── Skeleton (loading) ───────────────────────────────────────────────────

function SkeletonBlock() {
  return (
    <div
      role="status"
      aria-label="Chargement du statut du cache"
      className="space-y-3"
    >
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <div className="h-3 w-32 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-3 w-24 animate-pulse rounded bg-white/[0.06]" />
        </div>
      ))}
      <div className="mt-4 h-8 w-44 animate-pulse rounded-lg bg-white/[0.06]" />
    </div>
  )
}

// ── Erreur (fetch a échoué) ──────────────────────────────────────────────

interface ErrorBlockProps {
  message: string
  onRetry: () => void
}

function ErrorBlock({ message, onRetry }: ErrorBlockProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3.5 py-3 text-sm text-red-200"
    >
      <p className="font-medium">Impossible de récupérer le statut du cache.</p>
      <p className="mt-1 text-xs text-red-300/80">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 inline-flex items-center rounded-md border border-red-500/30 bg-red-500/[0.12] px-2.5 py-1 text-xs font-medium text-red-100 transition hover:bg-red-500/[0.2] focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
      >
        Réessayer
      </button>
    </div>
  )
}

// ── Dialog confirmation (déclenchement ETL) ──────────────────────────────

interface TriggerDialogProps {
  isEmpty: boolean
  onClose: () => void
}

/**
 * Dialog modal pour déclencher l'import SIRENE.
 *
 * SÉCURITÉ : le CRON_SECRET est strictement côté serveur. Au lieu de
 * proxyfier l'appel via une route session, on affiche la commande
 * `gh workflow run` à copier-coller — l'opérateur l'exécute dans son
 * terminal authentifié. C'est plus traçable (GitHub log d'audit) et
 * évite d'exposer un trigger HTTP supplémentaire.
 *
 * Texte de confirmation "GO" requis pour éviter le clic accidentel.
 */
function TriggerDialog({ isEmpty, onClose }: TriggerDialogProps) {
  const [confirmation, setConfirmation] = useState('')
  const [copied, setCopied] = useState(false)
  const isConfirmed = confirmation.trim().toUpperCase() === 'GO'

  // ESC ferme la modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(TRIGGER_COMMAND)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // navigator.clipboard peut échouer en contexte non-https — fallback silencieux.
      setCopied(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trigger-dialog-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-t-2xl border border-white/[0.08] bg-gray-950 p-6 shadow-2xl sm:rounded-2xl">
        <h3
          id="trigger-dialog-title"
          className="font-mono text-xs font-semibold uppercase tracking-widest text-cyan-300"
        >
          {`// ${isEmpty ? 'IMPORT INITIAL' : 'RE-IMPORT SIRENE'}`}
        </h3>
        <p className="mt-3 text-sm text-gray-200">
          Lancer un import SIRENE ? L&apos;opération prend 15-30 minutes via
          GitHub Actions.
        </p>
        <p className="mt-2 text-xs text-gray-400">
          Le timeout Vercel (800s max) est insuffisant pour l&apos;ETL bulk.
          Exécutez la commande ci-dessous dans votre terminal authentifié
          GitHub CLI :
        </p>

        <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/40 px-3 py-2">
          <code className="flex-1 truncate font-mono text-xs text-cyan-200">
            {TRIGGER_COMMAND}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copier la commande"
            className="flex-shrink-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs font-medium text-gray-200 transition hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            {copied ? 'Copié' : 'Copier'}
          </button>
        </div>

        <div className="mt-5 space-y-1.5">
          <label
            htmlFor="trigger-confirm"
            className="block text-xs font-medium uppercase tracking-wider text-gray-400"
          >
            Tapez « GO » pour confirmer
          </label>
          <input
            id="trigger-confirm"
            type="text"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="GO"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 font-mono text-sm uppercase tracking-widest text-white placeholder-gray-500 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-gray-200 transition hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => {
              // Confirmation purement UI : on guide l'utilisateur vers le
              // terminal — pas d'appel HTTP côté navigateur (cf. note
              // sécurité ci-dessus). On ferme la modal une fois "GO" tapé.
              if (isConfirmed) onClose()
            }}
            disabled={!isConfirmed}
            className="rounded-lg border border-cyan-500/30 bg-cyan-500/[0.12] px-3.5 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/[0.2] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            J&apos;ai exécuté la commande
          </button>
        </div>
      </div>
    </div>
  )
}
