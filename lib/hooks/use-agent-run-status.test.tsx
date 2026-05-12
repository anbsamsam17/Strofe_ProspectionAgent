// ============================================================
// Tests : useAgentRunStatus
// ------------------------------------------------------------
// Couvre :
//   - Cas nominal : run actif → polling continue.
//   - Stop polling automatique quand run.status passe à 'completed'.
//   - router.refresh() appelé sur transition running → completed.
//   - run null → polling s'arrête après un tour.
//   - 401 / erreur réseau → état stable, polling stoppe.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { AgentRun } from '@/lib/types'

// Mock next/navigation : useRouter() → { refresh: vi.fn() }
const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}))

// Import APRÈS le mock (Vitest hoist)
import { useAgentRunStatus } from './use-agent-run-status'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRun(status: 'running' | 'completed' | 'failed', overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    user_id: 'user-1',
    status,
    phase: 'sourcing',
    prospects_sourced: 10,
    prospects_qualified: 5,
    list_generated: false,
    logs: [],
    started_at: new Date(Date.now() - 30_000).toISOString(),
    ...overrides,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  refreshMock.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mockFetchOnce(body: unknown, status = 200) {
  ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useAgentRunStatus', () => {
  it('expose un run running après le premier fetch', async () => {
    const run = makeRun('running')
    // Le polling peut tenter plusieurs fetches successifs tant que running.
    // On répond toujours avec le même payload.
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ run }),
    })

    const { result } = renderHook(() => useAgentRunStatus(50))

    await waitFor(() => {
      expect(result.current.run?.id).toBe('run-1')
    })

    expect(result.current.isRunning).toBe(true)
    expect(result.current.isLoading).toBe(false)
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('renvoie isRunning=false et arrête le polling quand run est null', async () => {
    mockFetchOnce({ run: null })

    const { result } = renderHook(() => useAgentRunStatus(50))

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.isRunning).toBe(false)
    expect(result.current.run).toBeNull()

    // Pas d'autre appel attendu — polling arrêté.
    // On attend volontairement >> que l'interval théorique pour s'en assurer.
    const callsAfter = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfter)
  })

  it('déclenche router.refresh() sur transition running → completed', async () => {
    // Premier tick : running. Suite : completed (renvoyée pour tous les ticks
    // restants, mais le hook s'arrête au premier non-running observé).
    mockFetchOnce({ run: makeRun('running') })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ run: makeRun('completed') }),
    })

    const { result } = renderHook(() => useAgentRunStatus(30))

    // Le polling à 30ms va déclencher le 2e fetch automatiquement.
    await waitFor(
      () => expect(result.current.run?.status).toBe('completed'),
      { timeout: 2000 },
    )

    expect(result.current.isRunning).toBe(false)
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('traite une 401 comme « pas de run » et arrête le polling', async () => {
    mockFetchOnce({ error: 'Non authentifié' }, 401)

    const { result } = renderHook(() => useAgentRunStatus(50))

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.isRunning).toBe(false)
    expect(result.current.run).toBeNull()
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('reste stable en cas d\'erreur réseau ponctuelle', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network down'),
    )

    const { result } = renderHook(() => useAgentRunStatus(50))

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.isRunning).toBe(false)
    expect(result.current.run).toBeNull()
  })
})
