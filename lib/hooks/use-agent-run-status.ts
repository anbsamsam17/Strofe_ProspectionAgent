'use client'

// ============================================================
// useAgentRunStatus
// ------------------------------------------------------------
// Hook Client : poll /api/agent/status toutes les `pollIntervalMs`
// tant qu'un run de l'utilisateur est `status === 'running'`.
// Stoppe le polling automatiquement dès qu'on observe un autre statut
// (ou `run: null`). Redéclenche un fetch immédiat à chaque mount.
//
// Détecte les transitions running → completed/failed et appelle
// `router.refresh()` pour invalider les Server Components parents
// (dashboard, prospects, layout) afin que les Données « du jour »
// soient rerendues sans rechargement complet.
//
// Pas d'accès Supabase direct : tout passe par /api/agent/status
// (RLS implicite via la session SSR).
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AgentRun } from '@/lib/types'

const DEFAULT_POLL_INTERVAL_MS = 5000

interface StatusResponse {
  run: AgentRun | null
  dailyListReady?: boolean
  todayCallsCount?: number
}

export interface UseAgentRunStatusResult {
  /** True ssi le dernier run de l'user est `status === 'running'`. */
  isRunning: boolean
  /** Dernier run vu par le client (peut être terminé / null). */
  run: AgentRun | null
  /** True pendant le tout premier fetch tant qu'aucun cycle n'a renvoyé. */
  isLoading: boolean
}

/**
 * Type guard minimal sur la forme attendue de /api/agent/status.
 * On reste tolérant : on s'intéresse uniquement à `run`, qui peut
 * être un objet ou null. Les autres champs sont ignorés ici.
 */
function isStatusResponse(value: unknown): value is StatusResponse {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  // `run` doit exister explicitement et être objet ou null
  return 'run' in v && (v.run === null || typeof v.run === 'object')
}

export function useAgentRunStatus(
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): UseAgentRunStatusResult {
  const router = useRouter()
  const [run, setRun] = useState<AgentRun | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  // On garde la dernière valeur de `isRunning` connue côté ref pour
  // détecter la transition running → !running et déclencher `router.refresh()`.
  const wasRunningRef = useRef<boolean>(false)

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null
    let activeController: AbortController | null = null

    async function fetchStatus(): Promise<AgentRun | null> {
      const controller = new AbortController()
      activeController = controller

      try {
        const response = await fetch('/api/agent/status', {
          method: 'GET',
          credentials: 'include',
          signal: controller.signal,
          // Pas de cache : /api/agent/status est marquée `force-dynamic`
          // côté serveur, on enfonce le clou côté client.
          cache: 'no-store',
        })

        if (!response.ok) {
          // 401 ou 5xx : on traite comme « pas de run visible » et on
          // arrête le polling. Pas de retry agressif côté UI.
          return null
        }

        const raw: unknown = await response.json().catch(() => null)
        if (!isStatusResponse(raw)) return null
        return raw.run
      } catch (err) {
        // AbortError = unmount ou cycle suivant, silencieux.
        if (err instanceof DOMException && err.name === 'AbortError') {
          return null
        }
        // Erreur réseau ponctuelle : on garde l'état courant et on
        // laissera le prochain tick retenter. Pas de console.log en succès,
        // mais ici on est explicitement sur un cas d'erreur transient — on
        // reste silencieux car Sentry capture déjà via fetch global.
        return null
      } finally {
        if (activeController === controller) {
          activeController = null
        }
      }
    }

    function stopPolling() {
      if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
      }
    }

    async function tick() {
      const nextRun = await fetchStatus()
      if (cancelled) return

      const nextIsRunning = nextRun?.status === 'running'

      // Détection de transition running → terminé/failed → refresh SC.
      if (wasRunningRef.current && !nextIsRunning) {
        router.refresh()
      }
      wasRunningRef.current = nextIsRunning

      setRun(nextRun)
      setIsLoading(false)

      // Si le run n'est plus actif, on arrête le polling pour éviter
      // de hammered l'API quand l'utilisateur reste sur la page.
      // Le hook redémarre à chaque mount (changement de page).
      if (!nextIsRunning) {
        stopPolling()
      }
    }

    // Kick-off : un fetch immédiat, puis interval seulement si running.
    void tick().then(() => {
      if (cancelled) return
      if (wasRunningRef.current && intervalId === null) {
        intervalId = setInterval(() => {
          void tick()
        }, pollIntervalMs)
      }
    })

    return () => {
      cancelled = true
      stopPolling()
      activeController?.abort()
    }
    // `router` est une ref stable côté Next ; pollIntervalMs sert d'invalidation.
  }, [pollIntervalMs, router])

  return {
    isRunning: run?.status === 'running',
    run,
    isLoading,
  }
}
