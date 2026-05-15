// ============================================================
// useGlanStatus — hook client de polling de /api/glan/status
//
// Polling toutes les 5s avec abort sur unmount. Le polling se met en pause
// si l'onglet est masqué (Page Visibility API) pour économiser le quota.
//
// État sémantique :
//   - glanState : 'dormant' | 'working' | 'done' | 'error'
//   - phase : phase courante du run (ex. 'sourcing', 'pitch_gen')
//   - phaseStartedAt : ISO du début de la phase courante
//   - run : agent_run complet (logs inclus)
//   - dailyListReady : booléen
//   - todayCallsCount : nombre d'appels passés aujourd'hui
//   - isLoading : true uniquement avant le premier fetch
// ============================================================

import { useEffect, useRef, useState } from 'react'
import type { AgentRun } from '@/lib/types'

export type GlanState = 'dormant' | 'working' | 'done' | 'error'

export interface GlanStatusData {
  run: AgentRun | null
  phase: string | null
  phaseStartedAt: string | null
  glanState: GlanState
  dailyListReady: boolean
  todayCallsCount: number
}

interface UseGlanStatusReturn extends GlanStatusData {
  isLoading: boolean
  error: string | null
}

const POLL_INTERVAL_MS = 5_000

const INITIAL: GlanStatusData = {
  run: null,
  phase: null,
  phaseStartedAt: null,
  glanState: 'dormant',
  dailyListReady: false,
  todayCallsCount: 0,
}

export function useGlanStatus(): UseGlanStatusReturn {
  const [data, setData] = useState<GlanStatusData>(INITIAL)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let isMounted = true
    let timer: ReturnType<typeof setTimeout> | null = null

    async function fetchStatus() {
      // Skip si l'onglet est caché — économise le quota et la latence
      if (typeof document !== 'undefined' && document.hidden) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch('/api/glan/status', {
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'same-origin',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { data: GlanStatusData }
        if (isMounted) {
          setData(json.data)
          setError(null)
          setIsLoading(false)
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Erreur inconnue')
          setIsLoading(false)
        }
      }
    }

    function schedule() {
      timer = setTimeout(async () => {
        await fetchStatus()
        if (isMounted) schedule()
      }, POLL_INTERVAL_MS)
    }

    // Premier fetch immédiat, puis polling
    fetchStatus().then(() => {
      if (isMounted) schedule()
    })

    // Re-fetch quand l'onglet redevient visible (l'utilisateur a peut-être raté
    // des changements pendant l'absence).
    function onVisibility() {
      if (!document.hidden) fetchStatus()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      isMounted = false
      if (timer) clearTimeout(timer)
      abortRef.current?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return { ...data, isLoading, error }
}
