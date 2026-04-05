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
      setTimeout(() => setSaveStatus('idle'), 3000)
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

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="space-y-6 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
      aria-label="Paramètres de l'agent"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Configuration de l&apos;agent
      </h2>

      {/* Description de l'offre */}
      <div>
        <label
          htmlFor="offer_description"
          className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Description de votre offre
          <span className="ml-1 text-xs font-normal text-gray-400 dark:text-gray-600">
            (utilisée par l&apos;IA pour générer les pitchs)
          </span>
        </label>
        <textarea
          id="offer_description"
          value={settings.offer_description ?? ''}
          onChange={(e) =>
            setSettings((prev) => ({ ...prev, offer_description: e.target.value }))
          }
          placeholder="Ex : Nous accompagnons les ETI dans la réalisation de leur bilan carbone réglementaire (BEGES Scope 1+2+3) et dans la construction de leur plan de décarbonation..."
          rows={5}
          className="w-full resize-none rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-600"
        />
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-600">
          {(settings.offer_description ?? '').length} caractères
        </p>
      </div>

      {/* Secteurs cibles */}
      <div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            Secteurs cibles
            <span className="ml-1 text-xs font-normal text-gray-400 dark:text-gray-600">
              ({(settings.target_sectors ?? []).length} sélectionnés)
            </span>
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {secteursDisponibles.map((secteur) => {
              const isSelected = (settings.target_sectors ?? []).includes(secteur)
              return (
                <label
                  key={secteur}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    isSelected
                      ? 'border-green-500 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950/40 dark:text-green-400'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSecteur(secteur)}
                    className="h-4 w-4 rounded accent-green-600"
                    aria-label={secteur}
                  />
                  <span className="leading-tight">{secteur}</span>
                </label>
              )
            })}
          </div>
        </fieldset>
      </div>

      {/* Ville / zone cible */}
      <div>
        <label
          htmlFor="target_city"
          className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Ville ou zone cible
        </label>
        <input
          id="target_city"
          type="text"
          value={settings.target_city ?? ''}
          onChange={(e) =>
            setSettings((prev) => ({ ...prev, target_city: e.target.value }))
          }
          placeholder="Ex : Lyon, Île-de-France, Rhône-Alpes..."
          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-600"
        />
      </div>

      {/* Nombre d'appels / jour */}
      <div>
        <label
          htmlFor="daily_call_target"
          className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Nombre d&apos;appels par jour :{' '}
          <span className="font-bold text-green-600 dark:text-green-400">
            {settings.daily_call_target}
          </span>
        </label>
        <input
          id="daily_call_target"
          type="range"
          min={5}
          max={20}
          step={1}
          value={settings.daily_call_target}
          onChange={(e) =>
            setSettings((prev) => ({
              ...prev,
              daily_call_target: parseInt(e.target.value, 10),
            }))
          }
          className="w-full accent-green-600"
          aria-label={`Nombre d'appels par jour : ${settings.daily_call_target}`}
        />
        <div className="flex justify-between text-xs text-gray-400 dark:text-gray-600">
          <span>5 appels</span>
          <span>20 appels</span>
        </div>
      </div>

      {/* Feedback sauvegarde */}
      {saveStatus === 'error' && errorMessage && (
        <p
          className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-400"
          role="alert"
        >
          {errorMessage}
        </p>
      )}
      {saveStatus === 'success' && (
        <p
          className="flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-700 dark:bg-green-950 dark:text-green-400"
          role="status"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Paramètres sauvegardés avec succès.
        </p>
      )}

      {/* Bouton submit */}
      <button
        type="submit"
        disabled={isSaving}
        aria-label="Sauvegarder les paramètres"
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-gray-900"
      >
        {isSaving ? (
          <>
            <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Sauvegarde...
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
