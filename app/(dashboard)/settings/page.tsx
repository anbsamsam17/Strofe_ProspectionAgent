import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_SCORING_WEIGHTS, type Profile, type ProfileSettings } from '@/lib/types'
import { SettingsForm } from '@/components/settings/settings-form'
import { LogoutButton } from '@/components/settings/logout-button'
import { SireneCacheStatus } from '@/components/settings/sirene-cache-status'

// Force le rendu dynamique — les settings doivent toujours refléter la valeur
// actuelle en base (pas de version cached servie après une mise à jour récente)
export const dynamic = 'force-dynamic'

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

  const persistedSettings = (profile?.settings as Partial<ProfileSettings> | undefined) ?? {}

  const settings: ProfileSettings = {
    sourcing_target_per_run: 15,
    target_sectors: [],
    target_postal_codes: [],
    target_city: '',
    offer_description: '',
    notification_email: '',
    scoring_weights: { ...DEFAULT_SCORING_WEIGHTS },
    ...persistedSettings,
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">

      {/* ── En-tête ──────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-white">
          Paramètres
        </h1>
        <p className="mt-0.5 text-sm text-gray-400">
          Compte, pondération du scoring, notifications.
        </p>
      </div>

      {/* ── Mon compte ───────────────────────────────────────── */}
      <section
        aria-labelledby="account-title"
        className="rounded-xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-md shadow-sm dark:border-gray-800/60 dark:bg-gray-900"
      >
        <div className="border-b border-white/[0.06] px-6 py-4 dark:border-gray-800/60">
          <h2
            id="account-title"
            className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-400"
          >
            Mon compte
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
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-400">
                    Nom
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-white">
                    {profile.full_name}
                  </p>
                </div>
              )}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-400">
                  Email
                </p>
                <p className="mt-0.5 text-sm text-gray-200">
                  {profile?.email ?? user.email}
                </p>
              </div>
              {/* TODO 2026-05-17 : champ "Entreprise" masqué (UI minimaliste).
                  Le champ profile.company_name reste persisté en DB. */}
              {/* {profile?.company_name && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    Entreprise
                  </p>
                  <p className="mt-0.5 text-sm text-gray-200">{profile.company_name}</p>
                </div>
              )} */}
            </div>
          </div>

          {/* Bouton de déconnexion */}
          <div className="mt-5 flex justify-end border-t border-white/[0.06] pt-4">
            <LogoutButton />
          </div>
        </div>
      </section>

      {/* ── Formulaire paramètres agent ──────────────────────── */}
      <SettingsForm initialSettings={settings} />

      {/* ── Cache SIRENE (état + déclenchement import) ────────── */}
      <SireneCacheStatus />
    </div>
  )
}
