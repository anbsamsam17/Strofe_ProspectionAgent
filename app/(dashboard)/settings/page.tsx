import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile, ProfileSettings } from '@/lib/types'
import { SettingsForm } from '@/components/settings/settings-form'

// Force le rendu dynamique — les settings doivent toujours refléter la valeur
// actuelle en base (pas de version cached servie après une mise à jour récente)
export const dynamic = 'force-dynamic'

const SECTEURS_DISPONIBLES = [
  'Industrie manufacturière',
  'Transport et logistique',
  'Construction et BTP',
  'Commerce de gros',
  'Commerce de détail',
  'Énergie et utilities',
  'Agriculture',
  'Services aux entreprises',
  'Santé',
  'Hôtellerie et restauration',
  'Immobilier',
  'Finance et assurance',
  'Technologies',
  'Éducation',
  'Administration publique',
]

export default async function SettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profileData } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const profile = profileData as Profile | null

  const settings: ProfileSettings = {
    daily_call_target: 15,
    target_sectors: [],
    target_city: '',
    offer_description: '',
    ...(profile?.settings as Partial<ProfileSettings> ?? {}),
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">

      {/* ── En-tête ──────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Paramètres
        </h1>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
          Configurez les critères de prospection utilisés par l&apos;agent IA.
        </p>
      </div>

      {/* ── Infos compte ─────────────────────────────────────── */}
      <section
        aria-labelledby="account-title"
        className="rounded-xl border border-gray-100 bg-white shadow-sm dark:border-gray-800/60 dark:bg-gray-900"
      >
        <div className="border-b border-gray-100 px-6 py-4 dark:border-gray-800/60">
          <h2
            id="account-title"
            className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-600"
          >
            Compte
          </h2>
        </div>

        <div className="px-6 py-5">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-green-700 text-lg font-bold text-white shadow-sm shadow-green-600/25">
              {(profile?.full_name ?? profile?.email ?? user.email ?? 'U').charAt(0).toUpperCase()}
            </div>

            {/* Infos */}
            <div className="min-w-0 flex-1 space-y-2">
              {profile?.full_name && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600">
                    Nom
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-white">
                    {profile.full_name}
                  </p>
                </div>
              )}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600">
                  Email
                </p>
                <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
                  {profile?.email ?? user.email}
                </p>
              </div>
              {profile?.company_name && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600">
                    Entreprise
                  </p>
                  <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
                    {profile.company_name}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Formulaire paramètres agent ──────────────────────── */}
      <SettingsForm
        initialSettings={settings}
        secteursDisponibles={SECTEURS_DISPONIBLES}
      />
    </div>
  )
}
