'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useAgentRunStatus } from '@/lib/hooks/use-agent-run-status'
import { NAF_GROUPS_SUGGESTED, type NafGroup } from '@/lib/constants/naf-codes'
import { NafCodeMultiSelect } from '@/components/settings/naf-code-multi-select'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SourcingModalProps {
  isOpen: boolean
  onClose: () => void
}

interface FormData {
  effectifMin: string
  effectifMax: string
  targetRegion: string
}

/**
 * Stats normalisées affichées à l'utilisateur après un run.
 * Compatibles avec la forme legacy `{ success, prospectsNew, prospectsUpdated, duration_ms }`
 * et la nouvelle forme Task 2.3 `{ ok, data: { ... } }`.
 */
interface RunStats {
  prospectsNew: number
  prospectsUpdated: number
  prospectsQualified: number | null
  totalAvailable: number | null
  exhausted: boolean
  /**
   * Vrai SSI l'API Sirene n'a renvoyé aucun résultat pour ces filtres dès
   * la 1ère page (univers vraiment vide), distinct de `exhausted` qui signifie
   * que le curseur a été consommé sur un univers non vide.
   */
  universeEmpty: boolean
  pagesLoaded: number | null
  durationMs: number | null
}

type ViewMode = 'form' | 'running' | 'results'

// ── Constantes ────────────────────────────────────────────────────────────────

// Source unique des groupes pré-définis « prospection B2B BEGES » — centralisée
// dans `lib/constants/naf-codes.ts` pour rester alignée avec la page Settings.
const SECTOR_OPTIONS: readonly NafGroup[] = NAF_GROUPS_SUGGESTED

const LOADING_MESSAGES: readonly string[] = [
  'Recherche en cours...',
  'Enrichissement BEGES...',
  'Scoring des prospects...',
  'Pagination Sirene...',
  'Dédoublonnage...',
] as const

const LOADING_MESSAGE_INTERVAL_MS = 3500
const CLIENT_TIMEOUT_MS = 5 * 60 * 1000 // 5 min : aligné sur maxDuration=300 côté route

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—'
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds === 0 ? `${minutes}min` : `${minutes}min ${seconds}s`
}

/**
 * Normalise la réponse API : tolère la forme legacy et la forme `{ ok, data }`
 * livrée par Task 2.3, sans coupler la modal à un format unique.
 */
function parseRunResponse(raw: unknown): RunStats | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  // Forme 2.3 : { ok: true, data: { ... } }
  const payload =
    r.data && typeof r.data === 'object'
      ? (r.data as Record<string, unknown>)
      : r // legacy : champs à la racine

  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null

  return {
    prospectsNew: num(payload.prospectsNew) ?? 0,
    prospectsUpdated: num(payload.prospectsUpdated) ?? 0,
    prospectsQualified: num(payload.prospectsQualified),
    totalAvailable: num(payload.totalAvailable),
    exhausted: payload.exhausted === true,
    universeEmpty: payload.universeEmpty === true,
    pagesLoaded: num(payload.pagesLoaded),
    // Tolère `durationMs` (2.3) et `duration_ms` (legacy)
    durationMs: num(payload.durationMs) ?? num(payload.duration_ms),
  }
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function SourcingModal({ isOpen, onClose }: SourcingModalProps) {
  const [formData, setFormData] = useState<FormData>({
    effectifMin: '50',
    effectifMax: '500',
    targetRegion: '',
  })
  const [selectedSectors, setSelectedSectors] = useState<Set<number>>(new Set())
  const [view, setView] = useState<ViewMode>('form')
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<RunStats | null>(null)
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0)
  // Portal : on ne rend la modal qu'après le mount côté client (pas de SSR)
  // pour éviter les mismatches d'hydratation et accéder à document.body.
  const [mounted, setMounted] = useState(false)

  const dialogRef = useRef<HTMLDivElement>(null)
  const firstFocusableRef = useRef<HTMLButtonElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const isLoading = view === 'running'

  // Détection « run global déjà en cours » (ex. lancé depuis un autre onglet).
  // On utilise la même source de vérité que les autres déclencheurs : le hook
  // qui poll /api/agent/status. On filtre le cas « c'est nous qui tournons »
  // sinon on s'auto-désactiverait pendant notre propre run en cours.
  const { isRunning: globalRunActive } = useAgentRunStatus()
  const externalRunActive = globalRunActive && !isLoading

  // Setup mount flag une seule fois côté client
  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  // Rotation des messages de loading pendant le run
  useEffect(() => {
    if (view !== 'running') return
    setLoadingMessageIndex(0)
    const id = window.setInterval(() => {
      setLoadingMessageIndex((i) => (i + 1) % LOADING_MESSAGES.length)
    }, LOADING_MESSAGE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [view])

  // Cleanup : abort en cas de démontage pendant un fetch en cours
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const handleClose = useCallback(() => {
    if (isLoading) return // verrouille la fermeture pendant le run
    onClose()
  }, [isLoading, onClose])

  // Fermer avec Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose()
      }
    },
    [isLoading, onClose]
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
      setTimeout(() => firstFocusableRef.current?.focus(), 50)
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, handleKeyDown])

  // Réinitialiser l'état à la fermeture, hydrater depuis le profil à l'ouverture.
  // Hydratation best-effort : si /api/profile/sourcing-defaults échoue, on garde
  // les valeurs locales par défaut (silencieux, pas de UX bloquante).
  useEffect(() => {
    if (!isOpen) {
      setFormData({ effectifMin: '50', effectifMax: '500', targetRegion: '' })
      setSelectedSectors(new Set())
      setError(null)
      setStats(null)
      setView('form')
      return
    }

    let cancelled = false
    fetch('/api/profile/sourcing-defaults', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        if (cancelled || !j || typeof j !== 'object') return
        const data = (j as { data?: unknown }).data
        if (!data || typeof data !== 'object') return
        const d = data as {
          targetSectors?: unknown
          targetRegion?: unknown
          effectifMin?: unknown
          effectifMax?: unknown
        }

        setFormData((prev) => ({
          effectifMin: typeof d.effectifMin === 'number' ? String(d.effectifMin) : prev.effectifMin,
          effectifMax: typeof d.effectifMax === 'number' ? String(d.effectifMax) : prev.effectifMax,
          targetRegion: typeof d.targetRegion === 'string' ? d.targetRegion : prev.targetRegion,
        }))

        if (Array.isArray(d.targetSectors) && d.targetSectors.length > 0) {
          const profileCodes = d.targetSectors.filter(
            (c): c is string => typeof c === 'string',
          )
          const sel = new Set<number>()
          SECTOR_OPTIONS.forEach((opt, idx) => {
            if (opt.codes.some((c) => profileCodes.includes(c))) sel.add(idx)
          })
          if (sel.size > 0) setSelectedSectors(sel)
        }
      })
      .catch(() => {
        /* silencieux : on garde les défauts locaux */
      })

    return () => {
      cancelled = true
    }
  }, [isOpen])

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget && !isLoading) {
      onClose()
    }
  }

  function toggleSector(index: number) {
    setSelectedSectors((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function resetToForm() {
    setStats(null)
    setError(null)
    setView('form')
  }

  function handleDoneAndRefresh() {
    onClose()
    // Refresh pour faire apparaître les nouveaux prospects côté SC parent.
    window.location.reload()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Court-circuit anti multi-onglet : si un autre run tourne déjà côté
    // serveur, on bloque ici plutôt que d'aller chercher un 409 RUN_IN_PROGRESS.
    if (externalRunActive) {
      setError('Un run est déjà en cours — patientez la fin avant d\'en lancer un autre.')
      return
    }

    const min = parseInt(formData.effectifMin, 10)
    const max = parseInt(formData.effectifMax, 10)

    if (isNaN(min) || min < 1) {
      setError("L'effectif minimum doit être un nombre supérieur à 0.")
      return
    }
    if (isNaN(max) || max < 1) {
      setError("L'effectif maximum doit être un nombre supérieur à 0.")
      return
    }
    if (min > max) {
      setError("L'effectif minimum ne peut pas être supérieur à l'effectif maximum.")
      return
    }

    // Aplatir les codes NAF des secteurs sélectionnés
    const flatNafCodes: string[] = []
    selectedSectors.forEach((idx) => {
      SECTOR_OPTIONS[idx]?.codes.forEach((code) => flatNafCodes.push(code))
    })

    // AbortController : permet le cleanup propre + un timeout client de sécurité.
    const controller = new AbortController()
    abortRef.current = controller
    const timeoutId = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)

    setView('running')

    try {
      const response = await fetch('/api/agent/sourcing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          effectifMin: min,
          effectifMax: max,
          targetSectors: flatNafCodes.length > 0 ? flatNafCodes : undefined,
          targetRegion: formData.targetRegion.trim() || undefined,
        }),
        signal: controller.signal,
      })

      const rawJson = (await response.json().catch(() => null)) as unknown

      if (!response.ok) {
        const errMsg =
          rawJson && typeof rawJson === 'object' && 'error' in rawJson
            ? String((rawJson as { error: unknown }).error)
            : `Erreur ${response.status} lors du lancement de la recherche.`
        throw new Error(errMsg)
      }

      const parsed = parseRunResponse(rawJson)
      if (!parsed) {
        throw new Error('Réponse inattendue du serveur.')
      }

      setStats(parsed)
      setView('results')
    } catch (err) {
      // AbortError → timeout client
      const isTimeout =
        err instanceof DOMException && err.name === 'AbortError'
      setError(
        isTimeout
          ? 'Le sourcing a dépassé 5 minutes. Il peut toujours s\'exécuter en arrière-plan — rafraîchissez la page dans quelques instants.'
          : err instanceof Error
            ? err.message
            : 'Une erreur inattendue est survenue.'
      )
      setView('form')
    } finally {
      window.clearTimeout(timeoutId)
      abortRef.current = null
    }
  }

  if (!isOpen || !mounted) return null

  // Portal : rend la modal directement sur document.body pour éviter qu'un
  // ancêtre avec backdrop-filter/transform/filter ne contraigne `position: fixed`.
  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] overflow-y-auto bg-black/60 backdrop-blur-sm"
      role="presentation"
      onClick={handleOverlayClick}
      aria-hidden={!isOpen}
    >
      <div className="flex min-h-full items-center justify-center p-4 py-8">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="sourcing-modal-title"
          aria-describedby="sourcing-modal-description"
          className="relative flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-xl dark:border-gray-700 dark:bg-gray-900"
          style={{ maxHeight: 'calc(100vh - 4rem)' }}
        >
          {/* En-tête */}
          <div className="border-b border-white/[0.06] px-6 py-5 dark:border-gray-800">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-green-100 text-green-600 dark:bg-green-950/60 dark:text-green-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </span>
                <div>
                  <h2
                    id="sourcing-modal-title"
                    className="text-base font-semibold text-gray-900 dark:text-white"
                  >
                    {view === 'results'
                      ? 'Résultats du sourcing'
                      : view === 'running'
                        ? 'Recherche en cours'
                        : 'Lancer une recherche de prospects'}
                  </h2>
                  <p
                    id="sourcing-modal-description"
                    className="mt-0.5 text-xs text-gray-500 dark:text-gray-400"
                  >
                    {view === 'results'
                      ? 'Récapitulatif du run.'
                      : view === 'running'
                        ? 'Peut prendre jusqu\'à 5 minutes.'
                        : 'Paramétrez les critères de ciblage pour l\'agent de sourcing.'}
                  </p>
                </div>
              </div>

              {/* Bouton fermer — désactivé pendant le run */}
              <button
                ref={firstFocusableRef}
                onClick={handleClose}
                disabled={isLoading}
                aria-label="Fermer la modal"
                className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:cursor-not-allowed dark:hover:bg-gray-800 dark:hover:text-gray-300"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Vues alternées : form / running / results */}
          {view === 'running' && (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
              <svg
                className="animate-spin text-green-600 dark:text-green-400"
                xmlns="http://www.w3.org/2000/svg"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <p
                className="mt-4 text-sm font-medium text-gray-700 dark:text-gray-300"
                role="status"
                aria-live="polite"
              >
                {LOADING_MESSAGES[loadingMessageIndex]}
              </p>
              <p className="mt-2 text-center text-xs text-gray-400 dark:text-gray-400">
                Ne fermez pas cette fenêtre.<br />Le run peut durer jusqu&apos;à 5 minutes.
              </p>
            </div>
          )}

          {view === 'results' && stats && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {/* Bandeau diagnostic — Contrat E :
                    - universeEmpty : 404 Sirene dès la 1ère page (aucune entreprise ne matche)
                    - exhausted : curseur consommé, l'univers existait mais tout est déjà sourcé
                    - sinon : pas de bandeau */}
                {stats.universeEmpty ? (
                  <div
                    role="status"
                    className="mb-4 rounded-lg border border-amber-300 bg-amber-100 px-4 py-3 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
                  >
                    <div className="flex items-start gap-2.5">
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
                        className="mt-0.5 flex-shrink-0"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      <div className="text-sm leading-snug">
                        <p className="font-semibold">
                          Aucune entreprise ne correspond à ces filtres
                        </p>
                        <p className="mt-1 text-xs">
                          Élargissez les effectifs, les secteurs ou la zone
                          géographique pour découvrir des prospects.
                        </p>
                        <button
                          type="button"
                          onClick={resetToForm}
                          className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-400 bg-white/[0.04] backdrop-blur-md px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-amber-600 dark:bg-amber-950/60 dark:text-amber-200 dark:hover:bg-amber-900/50"
                        >
                          Modifier les filtres
                        </button>
                      </div>
                    </div>
                  </div>
                ) : stats.exhausted ? (
                  <div
                    role="status"
                    className="mb-4 rounded-lg border border-orange-300 bg-orange-100 px-4 py-3 text-orange-800 dark:border-orange-700/60 dark:bg-orange-950/40 dark:text-orange-200"
                  >
                    <div className="flex items-start gap-2.5">
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
                        className="mt-0.5 flex-shrink-0"
                        aria-hidden="true"
                      >
                        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      <div className="text-sm leading-snug">
                        <p className="font-semibold">Univers épuisé pour ces filtres</p>
                        <p className="mt-1 text-xs">
                          {stats.totalAvailable !== null
                            ? `${stats.totalAvailable.toLocaleString('fr-FR')} entreprises au total — toutes déjà sourcées. `
                            : 'Toutes les entreprises correspondantes ont déjà été sourcées. '}
                          Essayez d&apos;autres secteurs, d&apos;autres régions ou un
                          effectif différent.
                        </p>
                        <button
                          type="button"
                          onClick={resetToForm}
                          className="mt-2 inline-flex items-center gap-1 rounded-md border border-orange-400 bg-white/[0.04] backdrop-blur-md px-2.5 py-1 text-xs font-medium text-orange-800 hover:bg-orange-50 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:border-orange-600 dark:bg-orange-950/60 dark:text-orange-200 dark:hover:bg-orange-900/50"
                        >
                          Élargir les filtres
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Stats post-run */}
                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    label="Nouveaux"
                    value={stats.prospectsNew.toLocaleString('fr-FR')}
                    tone="positive"
                  />
                  <StatCard
                    label="Mis à jour"
                    value={stats.prospectsUpdated.toLocaleString('fr-FR')}
                  />
                  {stats.prospectsQualified !== null && (
                    <StatCard
                      label="Qualifiés (score ≥ 20)"
                      value={stats.prospectsQualified.toLocaleString('fr-FR')}
                    />
                  )}
                  {stats.pagesLoaded !== null && (
                    <StatCard
                      label="Pages Sirene"
                      value={stats.pagesLoaded.toLocaleString('fr-FR')}
                    />
                  )}
                  <StatCard
                    label="Durée"
                    value={formatDuration(stats.durationMs)}
                  />
                  {stats.totalAvailable !== null && !stats.exhausted && (
                    <StatCard
                      label="Univers total"
                      value={stats.totalAvailable.toLocaleString('fr-FR')}
                    />
                  )}
                </div>
              </div>

              {/* Actions résultats */}
              <div className="flex flex-col-reverse justify-end gap-2 border-t border-white/[0.06] px-6 py-4 sm:flex-row sm:gap-3 dark:border-gray-800">
                <button
                  type="button"
                  onClick={resetToForm}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:focus:ring-offset-gray-900"
                >
                  Nouveau run
                </button>
                <button
                  type="button"
                  onClick={handleDoneAndRefresh}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-green-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                >
                  Voir les prospects
                </button>
              </div>
            </div>
          )}

          {view === 'form' && (
            <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="space-y-5">
                  {/* Effectif */}
                  <fieldset>
                    <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                      Effectif de l&apos;entreprise
                    </legend>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="effectifMin"
                          className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
                        >
                          Minimum
                        </label>
                        <input
                          id="effectifMin"
                          type="number"
                          min={1}
                          max={10000}
                          value={formData.effectifMin}
                          onChange={(e) =>
                            setFormData((prev) => ({ ...prev, effectifMin: e.target.value }))
                          }
                          disabled={isLoading}
                          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 dark:focus:border-green-500"
                          required
                          aria-describedby="effectif-hint"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="effectifMax"
                          className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
                        >
                          Maximum
                        </label>
                        <input
                          id="effectifMax"
                          type="number"
                          min={1}
                          max={10000}
                          value={formData.effectifMax}
                          onChange={(e) =>
                            setFormData((prev) => ({ ...prev, effectifMax: e.target.value }))
                          }
                          disabled={isLoading}
                          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 dark:focus:border-green-500"
                          required
                        />
                      </div>
                    </div>
                    <p id="effectif-hint" className="mt-1.5 text-xs text-gray-400 dark:text-gray-400">
                      Entre 1 et 10 000 salariés
                    </p>
                  </fieldset>

                  {/* Secteurs cibles */}
                  <fieldset>
                    <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                      Secteurs cibles
                      <span className="ml-1.5 text-xs font-normal text-gray-400 dark:text-gray-400">
                        (optionnel — tous si aucun coché)
                      </span>
                    </legend>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {SECTOR_OPTIONS.map((sector, index) => {
                        const isChecked = selectedSectors.has(index)
                        const checkboxId = `sector-${index}`
                        return (
                          <label
                            key={checkboxId}
                            htmlFor={checkboxId}
                            className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                              isChecked
                                ? 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950/40 dark:text-green-300'
                                : 'border-gray-200 bg-white/[0.04] backdrop-blur-md text-gray-700 hover:border-gray-300 hover:bg-white/[0.06] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                            } ${isLoading ? 'cursor-not-allowed opacity-60' : ''}`}
                          >
                            <input
                              id={checkboxId}
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSector(index)}
                              disabled={isLoading}
                              className="h-3.5 w-3.5 flex-shrink-0 rounded border-gray-300 text-green-600 accent-green-600 focus:ring-green-500 dark:border-gray-600"
                              aria-label={sector.label}
                            />
                            <span className="select-none leading-tight">{sector.label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </fieldset>

                  {/* Zone géographique */}
                  <div>
                    <label
                      htmlFor="targetRegion"
                      className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >
                      Zone géographique
                      <span className="ml-1.5 text-xs font-normal text-gray-400 dark:text-gray-400">
                        (optionnel)
                      </span>
                    </label>
                    <input
                      id="targetRegion"
                      type="text"
                      value={formData.targetRegion}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, targetRegion: e.target.value }))
                      }
                      disabled={isLoading}
                      placeholder="Ex : France, IDF, 75, Nouvelle-Aquitaine (vide = France entière)"
                      className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 dark:focus:border-green-500"
                      maxLength={30}
                      aria-describedby="region-hint"
                    />
                    <p id="region-hint" className="mt-1.5 text-xs text-gray-400 dark:text-gray-400">
                      Code département, label région, ou laisser vide pour France entière
                    </p>
                  </div>

                  {/* Message d'erreur */}
                  {error && (
                    <div
                      role="alert"
                      aria-live="assertive"
                      className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800/50 dark:bg-red-950/30"
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
                        className="mt-0.5 flex-shrink-0 text-red-500 dark:text-red-400"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 border-t border-white/[0.06] px-6 py-4 dark:border-gray-800">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isLoading}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:focus:ring-offset-gray-900"
                >
                  Annuler
                </button>

                <button
                  type="submit"
                  disabled={isLoading || externalRunActive}
                  aria-disabled={isLoading || externalRunActive}
                  title={externalRunActive ? 'Un run est déjà en cours' : undefined}
                  className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-green-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-gray-900"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    stroke="none"
                    aria-hidden="true"
                  >
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  <span>Lancer la recherche</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}

// ── Sous-composants ───────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: string
  tone?: 'neutral' | 'positive'
}

function StatCard({ label, value, tone = 'neutral' }: StatCardProps) {
  const valueClass =
    tone === 'positive'
      ? 'text-green-700 dark:text-green-400'
      : 'text-gray-900 dark:text-white'
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800/60">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  )
}
