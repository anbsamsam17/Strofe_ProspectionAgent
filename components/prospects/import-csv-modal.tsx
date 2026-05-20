'use client'

// ============================================================
// ImportCsvModal — Import CSV de SIREN warm (GLN-060)
//
// Modal accessible depuis /prospects qui permet à l'utilisateur de coller
// une liste de SIREN (1 par ligne ou séparés par virgule) issus de sa
// connaissance warm (LinkedIn, salons, recommandations) et de les ajouter
// au pipeline Glan.
//
// Flux :
//   1. Click sur "+ Importer" → ouvre la modal.
//   2. L'utilisateur colle ses SIREN dans la textarea, ajoute une note libre.
//   3. Click "Valider" → preview locale : X détectés, Y valides, Z erreurs.
//   4. Click "Lancer enrichissement" → POST /api/prospects/import.
//   5. Toast / résumé : N créés, M mis à jour, K erreurs.
//
// Parser : pas de Papa Parse — simple split sur whitespace/virgule + filter regex.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// ── Constantes UI ─────────────────────────────────────────────────────────────

const MAX_SIRENS = 100
const MAX_NOTE_LENGTH = 200
const SIREN_REGEX = /^\d{9}$/

// ── Helpers ───────────────────────────────────────────────────────────────────

interface ParseResult {
  /** SIREN normalisés à 9 chiffres et dédupliqués. */
  valid: string[]
  /** Tokens rejetés (non vides, non parseables). */
  invalid: string[]
  /** Doublons trouvés dans la source (informatif). */
  duplicates: number
}

/**
 * Parse une chaîne brute de SIREN (textarea) :
 *   - Split sur newline/virgule/point-virgule/tabulation/espaces multiples.
 *   - Trim, retire espaces/tirets/points internes.
 *   - Conserve uniquement les tokens à 9 chiffres.
 *   - Dédup interne.
 */
export function parseSirenInput(raw: string): ParseResult {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  const validSet = new Set<string>()
  const valid: string[] = []
  const invalid: string[] = []
  let duplicates = 0

  for (const token of tokens) {
    const cleaned = token.replace(/[\s\-.]/g, '')
    if (SIREN_REGEX.test(cleaned)) {
      if (validSet.has(cleaned)) {
        duplicates++
        continue
      }
      validSet.add(cleaned)
      valid.push(cleaned)
    } else {
      invalid.push(token)
    }
  }

  return { valid, invalid, duplicates }
}

// ── Types réponse API ─────────────────────────────────────────────────────────

interface ImportApiData {
  created: number
  updated: number
  errors: Array<{ siren: string; reason: string }>
  total_processed?: number
}

interface ImportApiResponse {
  data?: ImportApiData
  error?: {
    code: string
    message: string
  }
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function ImportCsvModal() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [sirensRaw, setSirensRaw] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<ImportApiData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const preview = parseSirenInput(sirensRaw)
  const overLimit = preview.valid.length > MAX_SIRENS

  // ── Effets : focus + ESC ────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => textareaRef.current?.focus(), 30)
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) closeDialog()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending])

  function closeDialog() {
    if (pending) return
    setOpen(false)
    setPreviewing(false)
    setResult(null)
    setError(null)
    triggerRef.current?.focus()
  }

  function resetAndClose() {
    setSirensRaw('')
    setNote('')
    closeDialog()
  }

  async function handleSubmit() {
    if (preview.valid.length === 0) return
    if (overLimit) return
    setPending(true)
    setError(null)

    try {
      const res = await fetch('/api/prospects/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sirens: preview.valid,
          note: note.trim() || undefined,
        }),
      })
      const data = (await res.json()) as ImportApiResponse
      if (!res.ok) {
        throw new Error(data.error?.message ?? 'Erreur serveur')
      }
      setResult(data.data ?? null)
      // Rafraîchit la page pour refléter les nouveaux prospects.
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setPending(false)
    }
  }

  // ── Bouton trigger ──────────────────────────────────────────────────────────
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 transition-colors hover:border-cyan-500/50 hover:bg-cyan-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
        aria-label="Importer une liste de SIREN"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Importer
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-csv-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <button
            type="button"
            onClick={closeDialog}
            aria-label="Fermer la fenêtre"
            disabled={pending}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            tabIndex={-1}
          />

          {/* Modal panel */}
          <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[0.08] bg-[oklch(13%_0.022_250)] shadow-2xl">
            <div className="h-px w-full bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent" aria-hidden="true" />

            {/* Header */}
            <div className="flex items-start justify-between border-b border-white/[0.06] px-6 py-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/70">
                  {'// import warm'}
                </p>
                <h2
                  id="import-csv-title"
                  className="mt-1 text-lg font-semibold text-white"
                >
                  Importer une liste de SIREN
                </h2>
                <p className="mt-1 text-xs text-gray-400">
                  Collez vos SIREN (LinkedIn, salons, recommandations) — Glan les
                  enrichira via Recherche Entreprises + ADEME.
                </p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                disabled={pending}
                aria-label="Fermer"
                className="ml-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
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
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="space-y-4 px-6 py-5">
              {result === null ? (
                <>
                  {/* Textarea SIREN */}
                  <div>
                    <label
                      htmlFor="import-sirens-textarea"
                      className="block text-xs font-medium text-gray-300"
                    >
                      SIREN (1 par ligne ou séparés par virgule) —
                      <span className="ml-1 font-mono text-cyan-400/80">
                        9 chiffres chacun
                      </span>
                    </label>
                    <textarea
                      id="import-sirens-textarea"
                      ref={textareaRef}
                      value={sirensRaw}
                      onChange={(e) => setSirensRaw(e.target.value)}
                      disabled={pending}
                      rows={8}
                      placeholder={'552120222\n542065479\n775665019'}
                      className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-sm text-white placeholder-gray-500 focus:border-cyan-500/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50"
                    />
                  </div>

                  {/* Champ note */}
                  <div>
                    <label
                      htmlFor="import-note-input"
                      className="block text-xs font-medium text-gray-300"
                    >
                      Note d&apos;import (optionnelle, {MAX_NOTE_LENGTH} car. max)
                    </label>
                    <input
                      id="import-note-input"
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
                      disabled={pending}
                      placeholder="Pollutec 2026, Recommandation Sanofi, etc."
                      className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan-500/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50"
                    />
                  </div>

                  {/* Preview compteurs */}
                  {(previewing || sirensRaw.trim().length > 0) && (
                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                      <p className="font-mono text-xs text-gray-400">
                        <span className="text-gray-300">
                          {preview.valid.length + preview.invalid.length}
                        </span>{' '}
                        SIREN détectés ·{' '}
                        <span className="text-green-400">{preview.valid.length}</span>{' '}
                        valides ·{' '}
                        <span className="text-red-400">{preview.invalid.length}</span>{' '}
                        invalides
                        {preview.duplicates > 0 && (
                          <>
                            {' · '}
                            <span className="text-yellow-400">
                              {preview.duplicates}
                            </span>{' '}
                            doublons
                          </>
                        )}
                      </p>
                      {preview.invalid.length > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-red-300/80 hover:text-red-300">
                            Voir les rejets ({preview.invalid.length})
                          </summary>
                          <ul className="mt-1 max-h-24 overflow-y-auto font-mono text-[11px] text-red-300/70">
                            {preview.invalid.slice(0, 20).map((s, i) => (
                              <li key={`${s}-${i}`} className="truncate">
                                · {s}
                              </li>
                            ))}
                            {preview.invalid.length > 20 && (
                              <li className="italic opacity-60">
                                … et {preview.invalid.length - 20} de plus
                              </li>
                            )}
                          </ul>
                        </details>
                      )}
                      {overLimit && (
                        <p className="mt-2 text-xs text-red-300">
                          Maximum {MAX_SIRENS} SIREN par import. Réduisez la liste.
                        </p>
                      )}
                    </div>
                  )}

                  {error && (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
                    >
                      {error}
                    </div>
                  )}
                </>
              ) : (
                // ── Résumé post-import ─────────────────────────────────────
                <div className="space-y-3">
                  <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3">
                    <p className="text-sm font-semibold text-green-300">
                      Import terminé
                    </p>
                    <p className="mt-1 font-mono text-xs text-green-200/80">
                      <span className="text-green-300">{result.created}</span>{' '}
                      nouveau{result.created > 1 ? 'x' : ''}{' '}
                      ·{' '}
                      <span className="text-cyan-300">{result.updated}</span>{' '}
                      mis à jour
                      {result.errors.length > 0 && (
                        <>
                          {' · '}
                          <span className="text-red-300">{result.errors.length}</span>{' '}
                          erreur{result.errors.length > 1 ? 's' : ''}
                        </>
                      )}
                    </p>
                  </div>
                  {result.errors.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-xs text-gray-300 hover:text-white">
                        Voir les erreurs ({result.errors.length})
                      </summary>
                      <ul className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-[11px] text-red-300/80">
                        {result.errors.map((e, i) => (
                          <li key={`${e.siren}-${i}`} className="truncate">
                            <span className="text-gray-400">{e.siren}</span> —{' '}
                            {e.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-white/[0.06] bg-white/[0.02] px-6 py-4">
              {result === null ? (
                <>
                  <button
                    type="button"
                    onClick={closeDialog}
                    disabled={pending}
                    className="inline-flex items-center rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm font-medium text-gray-300 hover:border-white/20 hover:text-white disabled:opacity-50"
                  >
                    Annuler
                  </button>
                  {!previewing && (
                    <button
                      type="button"
                      onClick={() => setPreviewing(true)}
                      disabled={pending || sirensRaw.trim().length === 0}
                      className="inline-flex items-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 transition-colors hover:border-cyan-500/50 hover:bg-cyan-500/20 disabled:opacity-50"
                    >
                      Valider
                    </button>
                  )}
                  {previewing && (
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={
                        pending || preview.valid.length === 0 || overLimit
                      }
                      className="inline-flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm font-semibold text-green-300 transition-colors hover:border-green-500/50 hover:bg-green-500/20 disabled:opacity-50"
                    >
                      {pending && (
                        <svg
                          className="animate-spin"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden="true"
                        >
                          <circle
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeOpacity="0.25"
                          />
                          <path
                            d="M22 12a10 10 0 0 1-10 10"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                        </svg>
                      )}
                      {pending
                        ? 'Enrichissement en cours...'
                        : `Lancer enrichissement (${preview.valid.length})`}
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={resetAndClose}
                  className="inline-flex items-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 hover:border-cyan-500/50 hover:bg-cyan-500/20"
                >
                  Fermer
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
