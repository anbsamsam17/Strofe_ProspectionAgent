import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile, ProfileSettings } from '@/lib/types'
import { SettingsForm } from '@/components/settings/settings-form'

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
    <div className="mx-auto max-w-2xl space-y-8">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Paramètres de l&apos;agent
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Configurez les critères de prospection utilisés par l&apos;agent IA.
        </p>
      </div>

      {/* Infos compte */}
      <section
        aria-labelledby="account-title"
        className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
      >
        <h2 id="account-title" className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Compte
        </h2>
        <div className="space-y-1">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            <span className="font-medium">Email :</span>{' '}
            {profile?.email ?? user.email}
          </p>
          {profile?.full_name && (
            <p className="text-sm text-gray-700 dark:text-gray-300">
              <span className="font-medium">Nom :</span> {profile.full_name}
            </p>
          )}
          {profile?.company_name && (
            <p className="text-sm text-gray-700 dark:text-gray-300">
              <span className="font-medium">Entreprise :</span> {profile.company_name}
            </p>
          )}
        </div>
      </section>

      {/* Formulaire paramètres agent */}
      <SettingsForm
        initialSettings={settings}
        secteursDisponibles={SECTEURS_DISPONIBLES}
      />
    </div>
  )
}
