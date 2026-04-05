import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/sidebar'
import { DashboardHeader } from '@/components/layout/dashboard-header'
import type { AgentRun, DailyList } from '@/lib/types'

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
      .limit(1)
      .single(),
    supabase
      .from('daily_lists')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .single(),
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
    .single()

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
        <main className="flex-1 overflow-y-auto p-4 pb-24 sm:p-6 lg:pb-6">
          {children}
        </main>
      </div>

      {/* Navigation mobile en bas — rendu dans Sidebar */}
    </div>
  )
}
