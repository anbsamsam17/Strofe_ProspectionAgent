import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/sidebar'
import { DashboardHeader } from '@/components/layout/dashboard-header'
import type { AgentRun, DailyList } from '@/lib/types'

// Force le rendu dynamique sur TOUT le layout dashboard :
// le statut de l'agent (running/completed/failed) et la daily list du jour
// sont des données temps-réel qui ne doivent jamais être mises en cache par Next.js.
export const dynamic = 'force-dynamic'

async function getAgentStatus(userId: string): Promise<{
  agentRun: AgentRun | null
  dailyList: DailyList | null
}> {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  const [agentRunResult, dailyListResult] = await Promise.all([
    supabase
      .from('agent_runs')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      // BUG-FIX : .maybeSingle() au lieu de .single()
      // .single() throw une erreur PGRST116 si aucun run n'existe encore
      // .maybeSingle() retourne null proprement dans ce cas
      .maybeSingle(),
    supabase
      .from('daily_lists')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      // BUG-FIX : .maybeSingle() au lieu de .single()
      // .single() crash si aucune liste n'a encore été générée aujourd'hui
      .maybeSingle(),
  ])

  return {
    agentRun: agentRunResult.data as AgentRun | null,
    dailyList: dailyListResult.data as DailyList | null,
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // TypeScript ne comprend pas que redirect() est noreturn — cast explicite
  const authenticatedUser = user as NonNullable<typeof user>

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', authenticatedUser.id)
    // .single() est correct ici : le profil est créé automatiquement par trigger
    // dès l'inscription. Si absent (état incohérent), on gère null proprement.
    .maybeSingle()

  const profileData = profile as { full_name: string | null; email: string } | null

  const { agentRun, dailyList } = await getAgentStatus(authenticatedUser.id)

  const userName =
    profileData?.full_name ?? profileData?.email ?? authenticatedUser.email ?? 'Utilisateur'

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Sidebar desktop */}
      <Sidebar />

      {/* Zone principale */}
      <div className="flex flex-1 flex-col overflow-hidden lg:ml-64">
        <DashboardHeader
          userName={userName ?? 'Utilisateur'}
          agentRun={agentRun}
          dailyList={dailyList}
        />

        {/* Contenu de la page */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 pb-24 sm:p-6 lg:pb-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
