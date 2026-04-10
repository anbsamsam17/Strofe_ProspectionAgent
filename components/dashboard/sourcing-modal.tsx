'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SourcingModalProps {
  isOpen: boolean
  onClose: () => void
}

interface SectorOption {
  label: string
  codes: string[]
}

interface FormData {
  effectifMin: string
  effectifMax: string
  targetRegion: string
}

// ── Constantes ────────────────────────────────────────────────────────────────

const SECTOR_OPTIONS: SectorOption[] = [
  { label: 'Viticulture', codes: ['01.21Z', '01.22Z'] },
  { label: 'Aéronautique', codes: ['30.30Z'] },
  { label: 'Logistique / Transport', codes: ['52.10B', '52.29A', '49.41A', '49.41B', '52.21Z'] },
  { label: 'Agro-alimentaire', codes: ['10.11Z', '10.13A', '10.32Z', '10.51A', '10.71A', '46.17B'] },
  { label: 'Chimie', codes: ['20.11Z', '20.14Z', '20.15Z'] },
  { label: 'Sidérurgie / Métaux', codes: ['24.10Z', '24.20Z', '25.11Z', '25.29Z'] },
  { label: 'Énergie', codes: ['35.11Z', '35.14Z'] },
  { label: 'BTP', codes: ['41.20A', '41.20B', '42.11Z', '42.13A', '43.21A', '43.22A'] },
  { label: 'Hôtellerie / Restauration', codes: ['55.10Z', '56.10A'] },
]

// ── Composant ─────────────────────────────────────────────────────────────────

export function SourcingModal({ isOpen, onClose }: SourcingModalProps) {
  const [formData, setFormData] = useState<FormData>({
    effectifMin: '50',
    effectifMax: '500',
    targetRegion: '',
  })
  const [selectedSectors, setSelectedSectors] = useState<Set<number>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Portal : on ne rend le modal qu'après le mount côté client (pas de SSR)
  // pour éviter les mismatches d'hydratation et permettre l'accès à document.body.
  const [mounted, setMounted] = useState(false)

  const dialogRef = useRef<HTMLDivElement>(null)
  const firstFocusableRef = useRef<HTMLButtonElement>(null)

  // Setup mount flag une seule fois côté client
  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

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
      // Bloquer le scroll du body
      document.body.style.overflow = 'hidden'
      // Focus sur le premier élément focusable
      setTimeout(() => firstFocusableRef.current?.focus(), 50)
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, handleKeyDown])

  // Réinitialiser l'état quand la modal se ferme
  useEffect(() => {
    if (!isOpen) {
      setFormData({ effectifMin: '50', effectifMax: '500', targetRegion: '' })
      setSelectedSectors(new Set())
      setError(null)
    }
  }, [isOpen])

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    // Fermer seulement si on clique sur l'overlay, pas sur la card
    if (e.target === e.currentTarget && !isLoading) {
      onClose()
    }
  }

  function toggleSector(index: number) {
    setSelectedSectors((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Validation basique
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

    setIsLoading(true)

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
      })

      if (!response.ok) {
        const data = await response.json() as { error?: string }
        throw new Error(data.error ?? 'Erreur lors du lancement de la recherche.')
      }

      // Succès : fermer la modal et recharger la page pour voir les nouveaux prospects
      onClose()
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur inattendue est survenue.')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen || !mounted) return null

  // Portal : rend la modal directement sur document.body pour éviter que des
  // ancêtres avec backdrop-filter/transform/filter ne créent un containing block
  // pour position: fixed (cf. DashboardHeader qui a backdrop-blur-sm).
  // Sans portal, fixed inset-0 est contraint à la taille du header (64px).
  const modalContent = (
    // Overlay — scroll vertical pour que le contenu long reste accessible
    <div
      className="fixed inset-0 z-[9999] overflow-y-auto bg-black/60 backdrop-blur-sm"
      role="presentation"
      onClick={handleOverlayClick}
      aria-hidden={!isOpen}
    >
      {/* Wrapper flex pour centrer — min-h-full + py pour garantir l'espace en haut/bas */}
      <div className="flex min-h-full items-center justify-center p-4 py-8">
        {/* Dialog — max-h contraint, flex-col pour header sticky + body scrollable */}
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="sourcing-modal-title"
          aria-describedby="sourcing-modal-description"
          className="relative flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
          style={{ maxHeight: 'calc(100vh - 4rem)' }}
        >
        {/* En-tête */}
        <div className="border-b border-gray-100 px-6 py-5 dark:border-gray-800">
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
                  Lancer une recherche de prospects
                </h2>
                <p
                  id="sourcing-modal-description"
                  className="mt-0.5 text-xs text-gray-500 dark:text-gray-400"
                >
                  Paramétrez les critères de ciblage pour l&apos;agent de sourcing.
                </p>
              </div>
            </div>

            {/* Bouton fermer */}
            <button
              ref={firstFocusableRef}
              onClick={onClose}
              disabled={isLoading}
              aria-label="Fermer la modal"
              className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:cursor-not-allowed dark:hover:bg-gray-800 dark:hover:text-gray-300"
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

        {/* Formulaire — flex-1 pour occuper l'espace, min-h-0 pour autoriser le shrink */}
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
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-600 dark:focus:border-green-500"
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
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-600 dark:focus:border-green-500"
                      required
                    />
                  </div>
                </div>
                <p id="effectif-hint" className="mt-1.5 text-xs text-gray-400 dark:text-gray-600">
                  Entre 1 et 10 000 salariés
                </p>
              </fieldset>

              {/* Secteurs cibles */}
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  Secteurs cibles
                  <span className="ml-1.5 text-xs font-normal text-gray-400 dark:text-gray-600">
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
                            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
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
                  <span className="ml-1.5 text-xs font-normal text-gray-400 dark:text-gray-600">
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
                  placeholder="Ex : 33 (Gironde), 75 (Paris), 69 (Rhône)"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-600 dark:focus:border-green-500"
                  maxLength={5}
                  aria-describedby="region-hint"
                />
                <p id="region-hint" className="mt-1.5 text-xs text-gray-400 dark:text-gray-600">
                  Code département INSEE (2 chiffres, ex : 33 pour Gironde)
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
          <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:focus:ring-offset-gray-900"
            >
              Annuler
            </button>

            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-green-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-gray-900"
            >
              {isLoading ? (
                <>
                  <svg
                    className="animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    width="15"
                    height="15"
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
                  <span>Lancement en cours...</span>
                </>
              ) : (
                <>
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
                </>
              )}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
