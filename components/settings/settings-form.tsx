'use client'

import { useState } from 'react'
import type { ProfileSettings } from '@/lib/types'

interface SettingsFormProps {
  initialSettings: ProfileSettings
  secteursDisponibles: string[]
}

export function SettingsForm({ initialSettings, secteursDisponibles }: SettingsFormProps) {
  const [settings, setSettings] = useState<ProfileSettings>(initialSettings)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSaving(true)
    setSaveStatus('idle')
    setErrorMessage(null)

    try {
      const response = await fetch('/api/profile/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offer_description: settings.offer_description,
          target_sectors: settings.target_sectors,
          target_city: settings.target_city,
          daily_call_target: settings.daily_call_target,
        }),
      })

      if (!response.ok) {
        const data = await response.json() as { error?: string }
        throw new Error(data.error ?? 'Erreur lors de la sauvegarde')
      }

      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 3500)
    } catch (err) {
      setSaveStatus('error')
      setErrorMessage(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setIsSaving(false)
    }
  }

  function toggleSecteur(secteur: string) {
    setSettings((prev) => {
      const current = prev.target_sectors ?? []
      const next = current.includes(secteur)
        ? current.filter((s) => s !== secteur)
        : [...current, secteur]
      return { ...prev, target_sectors: next }
    })
  }

  const selectedSecteurs = settings.target_sectors ?? []
  const charCount = (settings.offer_description ?? '').length
  const dailyTarget = settings.daily_call_target

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label="Paramètres de l'agent"
      className="space-y-0"
    >
      {/* Section : Description de l'offre */}
      <div className="rounded-t-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-gray-800">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-green-50 dark:bg-green-950/40">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-green-600 dark:text-green-400"
                aria-hidden="true"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                Description de votre offre
              </h2>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Utilisée par l&apos;IA pour personnaliser les pitchs et accroches de chaque appel.
              </p>
            </div>
          </div>
        </div>
        <div className="px-6 py-5">
          <div className="relative">
            <textarea
              id="offer_description"
              value={settings.offer_description ?? ''}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, offer_description: e.target.value }))
              }
              placeholder="Ex : Nous accompagnons les ETI dans la réalisation de leur bilan carbone réglementaire (BEGES Scope 1+2+3) et dans la construction de leur plan de décarbonation..."
              rows={5}
              className="w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-600"
            />
            <span
              className={`absolute bottom-3 right-3 text-xs tabular-nums ${
                charCount > 800 ? 'text-orange-500' : 'text-gray-400 dark:text-gray-600'
              }`}
            >
              {charCount}
            </span>
          </div>
        </div>
      </div>

      {/* Section : Secteurs cibles */}
      <div className="-mt-px border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-gray-800">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/40">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-blue-600 dark:text-blue-400"
                aria-hidden="true"
              >
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Secteurs cibles
                </h2>
                {selectedSecteurs.length > 0 && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                    {selectedSecteurs.length} sélectionné{selectedSecteurs.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                L&apos;agent ciblera prioritairement les entreprises de ces secteurs.
              </p>
            </div>
          </div>
        </div>
        <div className="px-6 py-5">
          <fieldset>
            <legend className="sr-only">Secteurs cibles</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {secteursDisponibles.map((secteur) => {
                const isSelected = selectedSecteurs.includes(secteur)
                return (
                  <label
                    key={secteur}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm transition-all duration-150 ${
                      isSelected
                        ? 'border-green-500 bg-green-50 text-green-700 shadow-sm dark:border-green-600 dark:bg-green-950/40 dark:text-green-400'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800/50'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2 transition-all ${
                        isSelected
                          ? 'border-green-500 bg-green-500'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}
                      aria-hidden="true"
                    >
                      {isSelected && (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="white"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSecteur(secteur)}
                      className="sr-only"
                      aria-label={secteur}
                    />
                    <span className="leading-tight">{secteur}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>
        </div>
      </div>

      {/* Section : Zone géographique */}
      <div className="-mt-px border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-gray-800">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-950/40">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-purple-600 dark:text-purple-400"
                aria-hidden="true"
              >
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                Zone géographique
              </h2>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Ville, département ou région ciblée pour la prospection.
              </p>
            </div>
          </div>
        </div>
        <div className="px-6 py-5">
          <div className="relative">
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
              className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
              aria-hidden="true"
            >
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
            <input
              id="target_city"
              type="text"
              value={settings.target_city ?? ''}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, target_city: e.target.value }))
              }
              placeholder="Ex : Lyon, Île-de-France, Rhône-Alpes..."
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-11 pr-4 text-sm text-gray-900 placeholder-gray-400 transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-600"
            />
          </div>
        </div>
      </div>

      {/* Section : Objectif d'appels */}
      <div className="-mt-px rounded-b-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-gray-800">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-orange-50 dark:bg-orange-950/40">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-orange-600 dark:text-orange-400"
                aria-hidden="true"
              >
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.5 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.27 5.27l1.17-1.17a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.28 15l.64 1.92z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Objectif d&apos;appels par jour
                </h2>
                <span className="rounded-full bg-green-100 px-3 py-0.5 text-sm font-bold text-green-700 dark:bg-green-950 dark:text-green-400">
                  {dailyTarget}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Nombre de prospects dans votre liste quotidienne.
              </p>
            </div>
          </div>
        </div>
        <div className="px-6 py-5">
          {/* Slider stylisé */}
          <div className="relative mb-2 h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800">
            <div
              className="absolute left-0 top-0 h-2 rounded-full bg-green-500 transition-all"
              style={{ width: `${((dailyTarget - 5) / (20 - 5)) * 100}%` }}
              aria-hidden="true"
            />
          </div>
          <input
            id="daily_call_target"
            type="range"
            min={5}
            max={20}
            step={1}
            value={dailyTarget}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                daily_call_target: parseInt(e.target.value, 10),
              }))
            }
            className="w-full accent-green-600"
            aria-label={`Nombre d'appels par jour : ${dailyTarget}`}
          />
          <div className="mt-1 flex justify-between text-xs text-gray-400 dark:text-gray-600">
            <span>5 appels</span>
            <span>20 appels</span>
          </div>
        </div>
      </div>

      {/* Feedback sauvegarde */}
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

      {/* Bouton submit */}
      <button
        type="submit"
        disabled={isSaving}
        aria-label="Sauvegarder les paramètres"
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-gray-950"
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
            Sauvegarder les paramètres
          </>
        )}
      </button>
    </form>
  )
}
