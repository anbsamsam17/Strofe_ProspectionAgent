'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DEFAULT_SCORING_WEIGHTS, type ProfileSettings, type ScoringWeights } from '@/lib/types'
// TODO 2026-05-17 : import gardé car le composant est utilisé par la section
// "Secteurs cibles" masquée par demande user (UI minimaliste). Décommenter
// l'import si la section est ré-exposée.
// import { NafCodeMultiSelect } from './naf-code-multi-select'

interface SettingsFormProps {
  initialSettings: ProfileSettings
}

type ScoringPilier = keyof ScoringWeights

const SCORING_TOTAL = 100
// TODO 2026-05-17 : constante utilisée par la section "Zone géographique"
// masquée. Conservée pour faciliter le rétablissement éventuel.
// const POSTAL_CODE_REGEX = /^\d{5}$/

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
  // TODO 2026-05-17 : états ci-dessous liés à la section "Zone géographique"
  // (codes postaux) et "Avancé" (sourcing_target_per_run) — sections masquées.
  // Le payload PATCH continue d'envoyer les valeurs persistées en l'état.
  // const [postalCodeInput, setPostalCodeInput] = useState('')
  // const [postalCodeError, setPostalCodeError] = useState<string | null>(null)
  // const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const weights: ScoringWeights = settings.scoring_weights ?? { ...DEFAULT_SCORING_WEIGHTS }
  const weightsSum = weights.taille + weights.beges + weights.contact
  const isWeightsBalanced = weightsSum === SCORING_TOTAL

  // TODO 2026-05-17 : dérivés liés aux sections "Secteurs cibles" /
  // "Offre commerciale" / "Zone géographique" — toutes masquées.
  // const selectedSecteurs = settings.target_sectors ?? []
  // const charCount = (settings.offer_description ?? '').length
  // const postalCodes = useMemo(
  //   () => settings.target_postal_codes ?? [],
  //   [settings.target_postal_codes],
  // )

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

  // TODO 2026-05-17 : helpers attachés aux sections masquées.
  // function setSecteurs(codes: string[]) {
  //   setSettings((prev) => ({ ...prev, target_sectors: codes }))
  // }
  //
  // function addPostalCode() {
  //   const code = postalCodeInput.trim()
  //   if (!code) return
  //   if (!POSTAL_CODE_REGEX.test(code)) {
  //     setPostalCodeError('Code postal invalide (5 chiffres attendus).')
  //     return
  //   }
  //   if (postalCodes.includes(code)) {
  //     setPostalCodeError('Code postal déjà ajouté.')
  //     return
  //   }
  //   if (postalCodes.length >= 10) {
  //     setPostalCodeError('Maximum 10 codes postaux.')
  //     return
  //   }
  //   setSettings((prev) => ({
  //     ...prev,
  //     target_postal_codes: [...(prev.target_postal_codes ?? []), code],
  //   }))
  //   setPostalCodeInput('')
  //   setPostalCodeError(null)
  // }
  //
  // function removePostalCode(code: string) {
  //   setSettings((prev) => ({
  //     ...prev,
  //     target_postal_codes: (prev.target_postal_codes ?? []).filter((c) => c !== code),
  //   }))
  // }

  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSaving(true)
    setSaveStatus('idle')
    setErrorMessage(null)

    // On normalise systématiquement avant envoi pour garantir un payload propre.
    const normalizedWeights = normalizeWeightsClient(weights)

    try {
      // Note : on continue d'envoyer offer_description / target_sectors /
      // target_city / target_postal_codes / sourcing_target_per_run depuis
      // l'état local — ils restent persistés en DB même si l'UI ne les expose
      // plus (TODO 2026-05-17, section masquée). Le backend Zod accepte ces
      // champs sans changement.
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
      className="space-y-8"
    >
      {/* TODO 2026-05-17 : section "Secteurs cibles" masquée par demande user
          (UI minimaliste). Le param backend `target_sectors` reste fonctionnel
          via PATCH /api/profile/settings (valeurs DB préservées). */}
      {/* <section
        aria-labelledby="sectors-title"
        className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <header className="border-b border-white/[0.06] px-6 py-5 dark:border-gray-800">
          <h2 id="sectors-title" className="text-sm font-semibold uppercase tracking-wider text-gray-300">
            Secteurs cibles
          </h2>
          <p className="mt-1 text-sm text-gray-300">
            L'agent priorisera les entreprises dont le code NAF est coché.
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
      </section> */}

      {/* TODO 2026-05-17 : section "Zone géographique" masquée par demande user
          (UI minimaliste). Les params backend `target_city` et
          `target_postal_codes` restent fonctionnels via PATCH /api/profile/settings. */}
      {/* <section
        aria-labelledby="geo-title"
        className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        ... champs target_city + postal codes input ...
      </section> */}

      {/* ── Section : Pondération du scoring ──────────────────────────────── */}
      <section
        aria-labelledby="scoring-title"
        className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <header className="border-b border-white/[0.06] px-6 py-5 dark:border-gray-800">
          <h2
            id="scoring-title"
            className="text-sm font-semibold uppercase tracking-wider text-gray-300"
          >
            Pondération du scoring
          </h2>
          <p className="mt-1 text-sm text-gray-300">
            Ajustez l&apos;importance relative de chaque pilier dans le calcul du score.
          </p>
        </header>

        <div className="space-y-7 px-6 py-6">
          {(Object.keys(PILIERS_INFO) as ScoringPilier[]).map((pilier) => {
            const info = PILIERS_INFO[pilier]
            const value = weights[pilier]
            return (
              <div key={pilier} className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <label
                    htmlFor={`weight-${pilier}`}
                    className="text-sm font-medium text-white"
                  >
                    {info.label}
                  </label>
                  <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-sm font-semibold tabular-nums text-white">
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
                  className="block w-full accent-green-500"
                  aria-label={`Pondération ${info.label} : ${value} %`}
                />
                <p className="text-xs text-gray-400">{info.description}</p>
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
              className="text-sm text-gray-200"
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
            <div className="flex flex-shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={normalizeWeights}
                disabled={isWeightsBalanced}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-1.5 text-xs font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-green-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Normaliser
              </button>
              <button
                type="button"
                onClick={resetWeights}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 py-1.5 text-xs font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-green-500/20"
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
            className="text-sm font-semibold uppercase tracking-wider text-gray-300"
          >
            Notifications
          </h2>
          <p className="mt-1 text-sm text-gray-300">
            Email pour recevoir les listes journalières et alertes.
          </p>
        </header>
        <div className="px-6 py-6">
          <div className="space-y-1.5">
            <label
              htmlFor="notification_email"
              className="block text-sm font-medium text-gray-200"
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
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-4 py-2.5 text-sm text-white placeholder-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
            />
          </div>
        </div>
      </section>

      {/* TODO 2026-05-17 : section "Offre commerciale" masquée par demande user
          (UI minimaliste). Le param backend `offer_description` reste fonctionnel
          via PATCH /api/profile/settings (valeur DB préservée, exploitée par les
          pitchs IA). */}
      {/* <section
        aria-labelledby="offer-title"
        className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        ... textarea offer_description ...
      </section> */}

      {/* TODO 2026-05-17 : section "Avancé" (sourcing_target_per_run) masquée
          par demande user (UI minimaliste). Le param backend reste fonctionnel
          via PATCH /api/profile/settings (valeur DB préservée). */}
      {/* <section
        aria-labelledby="advanced-title"
        className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        ... toggle Avancé + slider sourcing_target_per_run ...
      </section> */}

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
