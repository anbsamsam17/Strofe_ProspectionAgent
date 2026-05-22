'use client'

// ============================================================
// DealValueEditor — saisie valeur deal (€) + probabilité (%)
// ------------------------------------------------------------
// Ticket : GLN-041 (valeur deal EUR + forecast pipeline pondéré)
//
// Deux contrôles côte-à-côte :
//   - Input number (€) : valeur du deal, max 99 999 999
//   - Select (%)       : probabilité parmi 5 paliers (10/25/50/75/100)
//
// Comportement :
//   - Si la valeur prospect est null à la première saisie, on pré-remplit
//     la probabilité avec `defaultProbabilityForStatus(statut)`.
//   - Auto-save sur blur (input €) et sur change (select %).
//   - PATCH /api/prospects/[id] avec `{ deal_value, deal_probability }`.
//   - Indicateur "Enregistrement… / Enregistré" + erreur inline.
//
// Forecast pondéré affiché en live à droite des contrôles.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import type { ProspectStatus } from '@/lib/types'
import {
  PROBABILITY_STEPS,
  computeForecast,
  defaultProbabilityForStatus,
  formatEuros,
} from '@/lib/pipeline/forecast'

// ------------------------------------------------------------
// TYPES
// ------------------------------------------------------------

interface DealValueEditorProps {
  prospectId: string
  statut: ProspectStatus
  /** Valeur deal initiale (null si jamais saisie). */
  initialDealValue: number | null
  /** Probabilité initiale (null = utiliser le mapping statut côté UI). */
  initialDealProbability: number | null
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

const SAVED_TOAST_MS = 1_500
const ERROR_TOAST_MS = 6_000

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

/**
 * Parse le contenu d'un input number en valeur DB-friendly :
 *   - "" / espaces → null
 *   - NaN          → null
 *   - négatif      → null (defensive ; le type=number minimum=0 le bloque déjà)
 *   - sinon        → number arrondi 2 décimales
 */
function parseInputValue(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

// ------------------------------------------------------------
// COMPOSANT
// ------------------------------------------------------------

export function DealValueEditor({
  prospectId,
  statut,
  initialDealValue,
  initialDealProbability,
}: DealValueEditorProps) {
  const router = useRouter()

  // Pré-remplissage : si probabilité null en DB, on prend la valeur par défaut
  // associée au statut. L'utilisateur peut override (et envoyer null pour
  // revenir au default ; côté affichage on reflète juste le mapping).
  const effectiveInitialProbability =
    initialDealProbability ?? defaultProbabilityForStatus(statut)

  const [dealValue, setDealValue] = useState<number | null>(initialDealValue)
  const [dealValueInput, setDealValueInput] = useState<string>(
    initialDealValue !== null ? String(initialDealValue) : '',
  )
  const [dealProbability, setDealProbability] = useState<number>(
    effectiveInitialProbability,
  )
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [])

  async function save(patch: {
    deal_value?: number | null
    deal_probability?: number | null
  }): Promise<void> {
    setStatus('saving')
    setErrorMsg(null)
    try {
      const response = await fetch(`/api/prospects/${prospectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string | { message?: string }
        }
        const message =
          typeof body.error === 'string'
            ? body.error
            : body.error?.message ?? 'Erreur lors de la sauvegarde'
        throw new Error(message)
      }
      setStatus('saved')
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(() => setStatus('idle'), SAVED_TOAST_MS)
      // Re-render server side pour refléter les nouveaux totaux (Kanban headers).
      router.refresh()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur inconnue')
      setStatus('error')
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(() => setStatus('idle'), ERROR_TOAST_MS)
    }
  }

  // ── Handlers ───────────────────────────────────────────────────────────

  function handleValueChange(e: React.ChangeEvent<HTMLInputElement>) {
    setDealValueInput(e.target.value)
  }

  function handleValueBlur() {
    const parsed = parseInputValue(dealValueInput)
    if (parsed === dealValue) return // pas de diff → no-op
    setDealValue(parsed)
    void save({ deal_value: parsed })
  }

  function handleProbabilityChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = Number(e.target.value)
    if (!Number.isFinite(next)) return
    setDealProbability(next)
    void save({ deal_probability: next })
  }

  const forecast = computeForecast(dealValue, dealProbability)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
        {/* Input deal_value */}
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
            Valeur estimée (€)
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={99_999_999}
            step={100}
            value={dealValueInput}
            onChange={handleValueChange}
            onBlur={handleValueBlur}
            placeholder="0"
            aria-label="Valeur estimée du deal en euros"
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
          />
        </label>

        {/* Select deal_probability */}
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
            Probabilité
          </span>
          <select
            value={dealProbability}
            onChange={handleProbabilityChange}
            aria-label="Probabilité de cloture du deal"
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
          >
            {PROBABILITY_STEPS.map((step) => (
              <option key={step} value={step} className="bg-gray-900 text-white">
                {step}%
              </option>
            ))}
          </select>
        </label>

        {/* Forecast affichage */}
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
            Forecast pondéré
          </span>
          <p
            className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-right text-sm font-semibold tabular-nums text-white"
            aria-label={`Forecast pondéré : ${forecast} euros`}
          >
            {formatEuros(forecast)}
          </p>
        </div>
      </div>

      <div className="flex min-h-[1rem] items-center justify-between text-xs">
        <span className="flex items-center gap-2 text-gray-400">
          {status === 'saving' && (
            <>
              <svg
                className="animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
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
              Enregistrement…
            </>
          )}
          {status === 'saved' && (
            <span className="text-green-400">Enregistré</span>
          )}
          {status === 'error' && (
            <span className="text-red-300" role="alert">
              {errorMsg ?? 'Erreur de sauvegarde'}
            </span>
          )}
          {status === 'idle' && (
            <span className="text-gray-500">
              Saisie auto-enregistrée à la sortie du champ
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
