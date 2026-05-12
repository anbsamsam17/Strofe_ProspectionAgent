// ============================================================
// TESTS — startHeartbeat (lib/agent/sourcing-runner.ts)
//
// Vérifie :
//   - le heartbeat pousse un log avec phase + counters à chaque tick
//   - stop() est idempotent
//   - le heartbeat reflète les mutations de l'objet `state` (lecture vivante)
//
// Pourquoi : détection post-mortem des timeouts Vercel — sans heartbeat, on ne
// sait pas où le run est mort quand il est kill à 300s.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startHeartbeat, type HeartbeatState } from '../sourcing-runner'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startHeartbeat', () => {
  it("pousse un log à chaque intervalle avec la phase et les counters courants", () => {
    const state: HeartbeatState = {
      phase: 'sourcing_loop',
      counters: { pages_loaded: 3, candidates_collected: 42 },
    }
    const pushLog = vi.fn()

    const stop = startHeartbeat(state, pushLog, 1_000)

    // Pas encore de tick
    expect(pushLog).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1_000)
    expect(pushLog).toHaveBeenCalledTimes(1)
    const [phase, msg, level, data] = pushLog.mock.calls[0]
    expect(phase).toBe('heartbeat')
    expect(msg).toBe('Run actif (heartbeat)')
    expect(level).toBe('info')
    expect((data as { current_phase: string }).current_phase).toBe('sourcing_loop')
    expect((data as { counters: Record<string, number> }).counters.pages_loaded).toBe(3)
    expect((data as { counters: Record<string, number> }).counters.candidates_collected).toBe(42)
    expect(typeof (data as { elapsed_ms: number }).elapsed_ms).toBe('number')

    stop()
  })

  it("reflète les mutations de l'état entre deux ticks", () => {
    const state: HeartbeatState = {
      phase: 'sourcing_init',
      counters: { pages_loaded: 0 },
    }
    const pushLog = vi.fn()
    const stop = startHeartbeat(state, pushLog, 500)

    vi.advanceTimersByTime(500)
    expect((pushLog.mock.calls[0][3] as { current_phase: string }).current_phase).toBe(
      'sourcing_init',
    )

    // Le caller mute l'état (transition de phase)
    state.phase = 'enrichissement'
    state.counters.pages_loaded = 5

    vi.advanceTimersByTime(500)
    expect((pushLog.mock.calls[1][3] as { current_phase: string }).current_phase).toBe(
      'enrichissement',
    )
    expect(
      (pushLog.mock.calls[1][3] as { counters: Record<string, number> }).counters.pages_loaded,
    ).toBe(5)

    stop()
  })

  it("stop() est idempotent et n'émet plus de tick après l'appel", () => {
    const state: HeartbeatState = { phase: 'x', counters: {} }
    const pushLog = vi.fn()
    const stop = startHeartbeat(state, pushLog, 200)

    vi.advanceTimersByTime(200)
    expect(pushLog).toHaveBeenCalledTimes(1)

    stop()
    stop() // 2e appel — no-op
    stop()

    vi.advanceTimersByTime(2_000) // beaucoup de temps : aucun tick supplémentaire
    expect(pushLog).toHaveBeenCalledTimes(1)
  })

  it("snapshotte counters par copie (pas de partage de référence avec un tick antérieur)", () => {
    const state: HeartbeatState = {
      phase: 'x',
      counters: { a: 1 },
    }
    const pushLog = vi.fn()
    const stop = startHeartbeat(state, pushLog, 100)

    vi.advanceTimersByTime(100)
    const firstSnap = (pushLog.mock.calls[0][3] as { counters: Record<string, number> }).counters

    // Mutation après le 1er tick : ne doit pas modifier la copie déjà émise
    state.counters.a = 999

    expect(firstSnap.a).toBe(1)
    stop()
  })
})
