'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DEFAULT_SCORING_WEIGHTS, type ProfileSettings, type ScoringWeights } from '@/lib/types'
import { NafCodeMultiSelect } from './naf-code-multi-select'

interface SettingsFormProps {
  initialSettings: ProfileSettings
}

type ScoringPilier = keyof ScoringWeights

const SCORING_TOTAL = 100
const POSTAL_CODE_REGEX = /^\d{5}$/

const PILIERS_INFO: Record<ScoringPilier, { label: string; description: string; accent: string }> = {
  taille: {
    label: 'Taille',
    description: 'Score max à effectif ~500, dégradation au-delà.',
    accent: 'green',
  },
  beges: {
    label: 'BEGES',
    description: 'Score max si BEGES manquant ou expiré (obligation L. 229-25).',
    accent: 'orange',
  },
  contact: {
    label: 'Contact',
    description: 'Score max si téléphone direct. Email = 50 %, LinkedIn = 25 %, rien = 0.',
    accent: 'blue',
  },
}

/**
 * Re-projection proportionnelle entière à 100. Si la somme est nulle, on retombe
 * sur les défauts. L'arrondi est absorbé par le pilier `contact` pour préserver
 * l'invariant somme === 100. Aligné avec `normalizeScoringWeights` côté agent.
 */
function normalizeWeightsClient(w: ScoringWeights): ScoringWeights {
  const sanitize = (n: number): number => (Number.isFinite(n) && n >= 0 ? n : 0)
  const taille = sanitize(w.taille)
  const beges = sanitize(w.beges)
  const contact = sanitize(w.contact)
  const sum = taille + beges + contact
  if (sum <= 0) return { ...DEFAULT_SCORING_WEIGHTS }
  const tailleN = Math.round((taille * SCORING_TOTAL) / sum)
  const begesN = Math.round((beges * SCORING_TOTAL) / sum)
  const contactN = SCORING_TOTAL - tailleN - begesN
  return { taille: tailleN, beges: begesN, contact: contactN }
}

export function SettingsForm({ initialSettings }: SettingsFormProps) {
  const [settings, setSettings] = useState<ProfileSettings>({
    ...initialSettings,
    scoring_weights: initialSettings.scoring_weights ?? { ...DEFAULT_SCORING_WEIGHTS },
  })
  const [postalCodeInput, setPostalCodeInput] = useState('')
  const [postalCodeError, setPostalCodeError] = useState<string | null>(null)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const weights: ScoringWeights = settings.scoring_weights ?? { ...DEFAULT_SCORING_WEIGHTS }
  const weightsSum = weights.taille + weights.beges + weights.contact
  const isWeightsBalanced = weightsSum === SCORING_TOTAL

  const selectedSecteurs = settings.target_sectors ?? []
  const charCount = (settings.offer_description ?? '').length
  const postalCodes = useMemo(
    () => settings.target_postal_codes ?? [],
    [settings.target_postal_codes],
  )

  function updateWeight(pilier: ScoringPilier, value: number) {
    setSettings((prev) => {
      const current = prev.scoring_weights ?? { ...DEFAULT_SCORING_WEIGHTS }
      return {
        ...prev,
        scoring_weights: { ...current, [pilier]: value },
      }
    })
  }

  function normalizeWeights() {
    setSettings((prev) => ({
      ...prev,
      scoring_weights: normalizeWeightsClient(prev.scoring_weights ?? { ...DEFAULT_SCORING_WEIGHTS }),
    }))
  }

  function resetWeights() {
    setSettings((prev) => ({
      ...prev,
      scoring_weights: { ...DEFAULT_SCORING_WEIGHTS },
    }))
  }

  function setSecteurs(codes: string[]) {
    setSettings((prev) => ({ ...prev, target_sectors: codes }))
  }

  function addPostalCode() {
    const code = postalCodeInput.trim()
    if (!code) return
    if (!POSTAL_CODE_REGEX.test(code)) {
      setPostalCodeError('Code postal invalide (5 chiffres attendus).')
      return
    }
    if (postalCodes.includes(code)) {
      setPostalCodeError('Code postal déjà ajouté.')
      return
    }
    if (postalCodes.length >= 10) {
      setPostalCodeError('Maximum 10 codes postaux.')
      return
    }
    setSettings((prev) => ({
      ...prev,
      target_postal_codes: [...(prev.target_postal_codes ?? []), code],
    }))
    setPostalCodeInput('')
    setPostalCodeError(null)
  }

  function removePostalCode(code: string) {
    setSettings((prev) => ({
      ...prev,
      target_postal_codes: (prev.target_postal_codes ?? []).filter((c) => c !== code),
    }))
  }

  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSaving(true)
    setSaveStatus('idle')
    setErrorMessage(null)

    // On normalise systématiquement avant envoi pour garantir un payload propre.
    const normalizedWeights = normalizeWeightsClient(weights)

    try {
      const response = await fetch('/api/profile/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offer_description: settings.offer_description,
          target_sectors: settings.target_sectors,
          target_city: settings.target_city,
          target_postal_codes: settings.target_postal_codes,
          notification_email: settings.notification_email || undefined,
          sourcing_target_per_run: settings.sourcing_target_per_run,
          scoring_weights: normalizedWeights,
        }),
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? 'Erreur lors de la sauvegarde')
      }

      // Reflète localement la version normalisée renvoyée par l'API.
      setSettings((prev) => ({ ...prev, scoring_weights: normalizedWeights }))
      setSaveStatus('success')
      router.refresh()
      setTimeout(() => setSaveStatus('idle'), 3500)
    } catch (err) {
      setSaveStatus('error')
      setErrorMessage(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label="Paramètres de l'agent"
      className="space-y-6"
    >
      {/* ── Section : Ciblage commercial — Secteurs ────────────────────────── */}
      <section
        aria-labelledby="sectors-title"
        className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <header className="border-b border-white/[0.06] px-6 py-5 dark:border-gray-800">
          <h2
            id="sectors-title"
            className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
          >
            Secteurs cibles
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            L&apos;agent priorisera les entreprises dont le code NAF est coché.
            Recherche par code (ex. 01.21) ou par libellé (ex. viticulture).
            {selectedSecteurs.length > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                {selectedSecteurs.length} code{selectedSecteurs.length > 1 ? 's' : ''} sélectionné{selectedSecteurs.length > 1 ? 's' : ''}
              </span>
            )}
          </p>
        </header>
        <div className="px-6 py-5">
          <NafCodeMultiSelect
            selectedCodes={selectedSecteurs}
            onChange={setSecteurs}
            labelledBy="sectors-title"
          />
        </div>
      </section>

      {/* ── Section : Zone géographique ─────────────────────────────────────── */}
      <section
        aria-labelledby="geo-title"
        className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <header className="border-b border-white/[0.06] px-6 py-5 dark:border-gray-800">
          <h2
            id="geo-title"
            className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
          >
            Zone géographique
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Ville, département ou région ciblée, et codes postaux complémentaires.
          </p>
        </header>
        <div className="space-y-5 px-6 py-5">
          <div>
            <label
              htmlFor="target_city"
              className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Ville / région
            </label>
            <input
              id="target_city"
              type="text"
              value={settings.target_city ?? ''}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, target_city: e.target.value }))
              }
              placeholder="Ex : Lyon, Île-de-France, Rhône-Alpes..."
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
            />
          </div>

          <div>
            <label
              htmlFor="postal_code_input"
              className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Codes postaux (max 10)
            </label>
            <div className="flex gap-2">
              <input
                id="postal_code_input"
                type="text"
                inputMode="numeric"
                pattern="\d{5}"
                maxLength={5}
                value={postalCodeInput}
                onChange={(e) => {
                  setPostalCodeInput(e.target.value.replace(/\D/g, '').slice(0, 5))
                  if (postalCodeError) setPostalCodeError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addPostalCode()
                  }
                }}
                placeholder="69001"
                className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-4 py-2.5 text-sm tabular-nums text-gray-900 placeholder-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
                aria-describedby={postalCodeError ? 'postal-code-error' : undefined}
              />
              <button
                type="button"
                onClick={addPostalCode}
                className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Ajouter
              </button>
            </div>
            {postalCodeError && (
              <p
                id="postal-code-error"
                role="alert"
                className="mt-2 text-xs text-red-600 dark:text-red-400"
              >
                {postalCodeError}
              </p>
            )}
            {postalCodes.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Codes postaux sélectionnés">
                {postalCodes.map((code) => (
                  <li
                    key={code}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1 text-xs font-medium tabular-nums text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    {code}
                    <button
                      type="button"
                      onClick={() => removePostalCode(code)}
                      aria-label={`Retirer le code postal ${code}`}
                      className="rounded-full text-gray-500 transition hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:text-gray-400 dark:hover:text-red-400"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
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
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* ── Section : Pondération du scoring (NEW) ──────────────────────────── */}
      <section
        aria-labelledby="scoring-title"
        className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <header className="border-b border-white/[0.06] px-6 py-5 dark:border-gray-800">
          <h2
            id="scoring-title"
            className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
          >
            Pondération du scoring
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Ajustez l&apos;importance relative de chaque pilier dans le calcul du score.
          </p>
        </header>

        <div className="space-y-6 px-6 py-5">
          {(Object.keys(PILIERS_INFO) as ScoringPilier[]).map((pilier) => {
            const info = PILIERS_INFO[pilier]
            const value = weights[pilier]
            return (
              <div key={pilier}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <label
                    htmlFor={`weight-${pilier}`}
                    className="text-sm font-medium text-gray-900 dark:text-white"
                  >
                    {info.label}
                  </label>
                  <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                    {value} %
                  </span>
                </div>
                <input
                  id={`weight-${pilier}`}
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={value}
                  onChange={(e) => updateWeight(pilier, parseInt(e.target.value, 10))}
                  className="w-full accent-green-600"
                  aria-label={`Pondération ${info.label} : ${value} %`}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{info.description}</p>
              </div>
            )
          })}

          <div
            className={`flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
              isWeightsBalanced
                ? 'border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/30'
                : 'border-orange-200 bg-orange-50 dark:border-orange-900/50 dark:bg-orange-950/30'
            }`}
          >
            <p
              role={isWeightsBalanced ? undefined : 'status'}
              aria-live="polite"
              className="text-sm text-gray-700 dark:text-gray-300"
            >
              <span className="tabular-nums">
                Taille: {weights.taille} % · BEGES: {weights.beges} % · Contact: {weights.contact} %
              </span>{' '}
              ·{' '}
              <span
                className={`font-semibold tabular-nums ${
                  isWeightsBalanced
                    ? 'text-green-700 dark:text-green-300'
                    : 'text-orange-700 dark:text-orange-300'
                }`}
              >
                Total: {weightsSum} %
              </span>
              {!isWeightsBalanced && (
                <span className="ml-2 text-xs text-orange-700 dark:text-orange-300">
                  (normalisé automatiquement à la sauvegarde)
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={normalizeWeights}
                disabled={isWeightsBalanced}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-green-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Normaliser
              </button>
              <button
                type="button"
                onClick={resetWeights}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Réinitialiser aux défauts (30 / 30 / 40)
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section : Notifications ─────────────────────────────────────────── */}
      <section
        aria-labelledby="notifications-title"
        className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <header className="border-b border-white/[0.06] px-6 py-5 dark:border-gray-800">
          <h2
            id="notifications-title"
            className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
          >
            Notifications
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Email pour recevoir les listes journalières et alertes.
          </p>
        </header>
        <div className="px-6 py-5">
          <label
            htmlFor="notification_email"
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Email de notification
          </label>
          <input
            id="notification_email"
            type="email"
            value={settings.notification_email ?? ''}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, notification_email: e.target.value }))
            }
            placeholder="prenom.nom@exemple.com"
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
          />
        </div>
      </section>

      {/* ── Section : Offre commerciale ─────────────────────────────────────── */}
      <section
        aria-labelledby="offer-title"
        className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <header className="border-b border-white/[0.06] px-6 py-5 dark:border-gray-800">
          <h2
            id="offer-title"
            className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
          >
            Offre commerciale
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Utilisée par l&apos;IA pour personnaliser les pitchs et accroches de chaque appel.
          </p>
        </header>
        <div className="px-6 py-5">
          <label htmlFor="offer_description" className="sr-only">
            Description de l&apos;offre
          </label>
          <div className="relative">
            <textarea
              id="offer_description"
              value={settings.offer_description ?? ''}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, offer_description: e.target.value }))
              }
              placeholder="Ex : Nous accompagnons les ETI dans la réalisation de leur bilan carbone réglementaire (BEGES Scope 1+2+3) et dans la construction de leur plan de décarbonation..."
              rows={6}
              maxLength={2000}
              className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
            />
            <span
              className={`absolute bottom-3 right-3 text-xs tabular-nums ${
                charCount > 1800 ? 'text-orange-500' : 'text-gray-400 dark:text-gray-400'
              }`}
            >
              {charCount} / 2000
            </span>
          </div>
        </div>
      </section>

      {/* ── Section : Avancé (legacy daily_call_target) ─────────────────────── */}
      <section
        aria-labelledby="advanced-title"
        className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <button
          type="button"
          onClick={() => setIsAdvancedOpen((v) => !v)}
          aria-expanded={isAdvancedOpen}
          aria-controls="advanced-content"
          className="flex w-full items-center justify-between px-6 py-5 text-left transition hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:hover:bg-gray-800/50"
        >
          <div>
            <h2
              id="advanced-title"
              className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
            >
              Avancé
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Paramètres hérités, conservés pour rétrocompatibilité.
            </p>
          </div>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`flex-shrink-0 text-gray-400 transition-transform dark:text-gray-500 ${
              isAdvancedOpen ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {isAdvancedOpen && (
          <div
            id="advanced-content"
            className="border-t border-white/[0.06] px-6 py-5 dark:border-gray-800"
          >
            <label
              htmlFor="sourcing_target_per_run"
              className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Cible de sourcing par run
              <span className="ml-2 text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                {settings.sourcing_target_per_run}
              </span>
            </label>
            <input
              id="sourcing_target_per_run"
              type="range"
              min={5}
              max={30}
              step={1}
              value={settings.sourcing_target_per_run}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  sourcing_target_per_run: parseInt(e.target.value, 10),
                }))
              }
              className="w-full accent-green-600"
              aria-label={`Cible de sourcing par run : ${settings.sourcing_target_per_run}`}
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Nombre cible de prospects sourcés par run nocturne (targetCandidates = max(N×3, 50)).
            </p>
          </div>
        )}
      </section>

      {/* ── Feedback ────────────────────────────────────────────────────────── */}
      {saveStatus === 'error' && errorMessage && (
        <div
          className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 dark:border-red-800/50 dark:bg-red-950/30"
          role="alert"
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
            className="flex-shrink-0 text-red-600 dark:text-red-400"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-sm text-red-700 dark:text-red-400">{errorMessage}</p>
        </div>
      )}

      {saveStatus === 'success' && (
        <div
          className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3.5 dark:border-green-800/50 dark:bg-green-950/30"
          role="status"
        >
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/50">
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
              className="text-green-600 dark:text-green-400"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-sm font-medium text-green-800 dark:text-green-300">
            Paramètres sauvegardés avec succès.
          </p>
        </div>
      )}

      {/* ── Bouton submit ───────────────────────────────────────────────────── */}
      <button
        type="submit"
        disabled={isSaving}
        aria-label="Sauvegarder les paramètres"
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-gray-950"
      >
        {isSaving ? (
          <>
            <svg
              className="animate-spin"
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
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Sauvegarde en cours...
          </>
        ) : (
          <>
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
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Enregistrer
          </>
        )}
      </button>
    </form>
  )
}
