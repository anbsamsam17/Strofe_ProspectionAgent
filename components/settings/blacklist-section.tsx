'use client'

// ============================================================
// BlacklistSection — Settings > Liste noire (GLN-061)
//
// Permet à l'utilisateur de gérer la liste de domaines email blacklistés
// (clients existants, concurrents). Tout prospect dont un email tombe dans
// cette liste est basculé en `do_not_contact` lors du run nocturne.
//
// Comportement :
//   - Mount → GET /api/blacklist-domains
//   - Add → POST → toast + refresh
//   - Delete → DELETE /api/blacklist-domains/[id] → refresh
//   - Validation côté client (regex + lowercase) pour feedback rapide.
// ============================================================

import { FormEvent, useEffect, useState } from 'react'

// ── Constantes ────────────────────────────────────────────────────────────────

const MAX_REASON_LENGTH = 200
const DOMAIN_REGEX = /^[a-z0-9.-]+\.[a-z]{2,}$/

// ── Types ─────────────────────────────────────────────────────────────────────

interface BlacklistEntry {
  id: string
  domain: string
  reason: string | null
  created_at: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalise un domaine côté client (miroir partiel de normalizeBlacklistDomain
 * côté serveur). Utilisé uniquement pour la validation feedback rapide ;
 * la source de vérité reste le backend.
 */
function previewNormalize(raw: string): string {
  let d = raw.trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '')
  if (d.startsWith('@')) d = d.slice(1)
  d = d.split('/')[0]
  return d
}

function isValidDomainClient(raw: string): boolean {
  return DOMAIN_REGEX.test(previewNormalize(raw))
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' })

// ── Composant ─────────────────────────────────────────────────────────────────

export function BlacklistSection() {
  const [entries, setEntries] = useState<BlacklistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [domain, setDomain] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Fetch initial ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/blacklist-domains', { method: 'GET' })
        const data = (await res.json()) as
          | { data: BlacklistEntry[] }
          | { error: { message: string } }
        if (!res.ok) {
          throw new Error(
            'error' in data ? data.error.message : 'Erreur chargement blacklist',
          )
        }
        if (!cancelled && 'data' in data) {
          setEntries(data.data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Erreur réseau')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // ── Add ─────────────────────────────────────────────────────────────────────
  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const cleaned = previewNormalize(domain)
    if (!isValidDomainClient(cleaned)) {
      setError(
        'Domaine invalide. Format attendu : "greenly.earth" (sans @, en minuscules).',
      )
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/blacklist-domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: cleaned,
          reason: reason.trim() || undefined,
        }),
      })
      const body = (await res.json()) as
        | { data: BlacklistEntry }
        | { error: { code: string; message: string } }
      if (!res.ok) {
        throw new Error('error' in body ? body.error.message : 'Erreur ajout')
      }
      if ('data' in body) {
        // Insère en tête (tri created_at desc).
        setEntries((prev) => [body.data, ...prev])
        setDomain('')
        setReason('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    setDeletingId(id)
    setError(null)
    try {
      const res = await fetch(`/api/blacklist-domains/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(body.error?.message ?? 'Erreur suppression')
      }
      setEntries((prev) => prev.filter((e) => e.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau')
    } finally {
      setDeletingId(null)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const domainPreview = domain ? previewNormalize(domain) : ''
  const isDomainValid = domain.length === 0 || isValidDomainClient(domain)

  return (
    <section
      aria-labelledby="blacklist-title"
      className="rounded-xl border border-white/[0.06] bg-white/[0.03] shadow-sm backdrop-blur-md"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
        <h2
          id="blacklist-title"
          className="text-xs font-semibold uppercase tracking-widest text-gray-400"
        >
          Liste noire — domaines email
        </h2>
        <span className="font-mono text-[11px] text-gray-400">
          {loading ? '…' : `${entries.length} domaine${entries.length > 1 ? 's' : ''}`}
        </span>
      </div>

      <div className="space-y-4 px-6 py-5">
        <p className="text-xs leading-relaxed text-gray-400">
          Les prospects dont un contact email tombe dans un domaine listé ici
          seront automatiquement basculés en{' '}
          <span className="font-medium text-gray-200">Ne pas contacter</span>{' '}
          lors du prochain run Glan. Idéal pour blacklister vos clients
          existants et vos concurrents.
        </p>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-300"
          >
            {error}
          </div>
        )}

        {/* ── Tableau des entrées ───────────────────────────────────────── */}
        <div className="overflow-hidden rounded-lg border border-white/[0.06]">
          <table className="w-full text-sm" aria-label="Domaines blacklistés">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/70">
                  Domaine
                </th>
                <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/70">
                  Raison
                </th>
                <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/70">
                  Ajouté
                </th>
                <th className="px-3 py-2 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-5 text-center text-xs text-gray-400"
                  >
                    Chargement…
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-xs text-gray-400"
                  >
                    Aucun domaine blacklisté. Ajoutez-en un ci-dessous.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]"
                  >
                    <td className="px-3 py-2.5 font-mono text-xs text-white">
                      {entry.domain}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-300">
                      {entry.reason || (
                        <span className="italic text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-gray-400">
                      {dateFmt.format(new Date(entry.created_at))}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(entry.id)}
                        disabled={deletingId === entry.id}
                        aria-label={`Supprimer ${entry.domain} de la blacklist`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                      >
                        {deletingId === entry.id ? (
                          <svg
                            className="animate-spin"
                            width="12"
                            height="12"
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
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                          </svg>
                        )}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Formulaire d'ajout ─────────────────────────────────────────── */}
        <form
          onSubmit={handleAdd}
          className="space-y-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-4"
        >
          <p className="text-xs font-medium text-gray-300">
            Ajouter un domaine
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto]">
            <div>
              <label
                htmlFor="blacklist-domain-input"
                className="block text-[10px] font-medium uppercase tracking-wider text-gray-400"
              >
                Domaine
              </label>
              <input
                id="blacklist-domain-input"
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                disabled={submitting}
                placeholder="greenly.earth"
                aria-invalid={!isDomainValid}
                className={`mt-1 w-full rounded-md border bg-white/[0.04] px-3 py-1.5 font-mono text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 disabled:opacity-50 ${
                  isDomainValid
                    ? 'border-white/[0.08] focus:border-cyan-500/40 focus:ring-cyan-500/30'
                    : 'border-red-500/40 focus:border-red-500/40 focus:ring-red-500/30'
                }`}
              />
              {domainPreview && domainPreview !== domain && (
                <p className="mt-1 font-mono text-[10px] text-gray-400">
                  → {domainPreview}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="blacklist-reason-input"
                className="block text-[10px] font-medium uppercase tracking-wider text-gray-400"
              >
                Raison (optionnelle)
              </label>
              <input
                id="blacklist-reason-input"
                type="text"
                value={reason}
                onChange={(e) =>
                  setReason(e.target.value.slice(0, MAX_REASON_LENGTH))
                }
                disabled={submitting}
                placeholder="Concurrent direct, client existant..."
                className="mt-1 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-cyan-500/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={submitting || !domain.trim() || !isDomainValid}
                className="h-9 rounded-md border border-green-500/30 bg-green-500/10 px-4 text-sm font-medium text-green-300 transition-colors hover:border-green-500/50 hover:bg-green-500/20 disabled:opacity-50"
              >
                {submitting ? '…' : 'Ajouter'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  )
}
