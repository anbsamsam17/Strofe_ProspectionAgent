import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/sidebar'
import { DashboardHeader } from '@/components/layout/dashboard-header'
import type { AgentRun } from '@/lib/types'

// Force le rendu dynamique sur TOUT le layout dashboard :
// le statut de l'agent (running/completed/failed) est une donnée temps-réel
// qui ne doit jamais être mise en cache par Next.js.
export const dynamic = 'force-dynamic'

async function getAgentRun(userId: string): Promise<AgentRun | null> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .maybeSingle()

  return data as AgentRun | null
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

  const authenticatedUser = user as NonNullable<typeof user>

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', authenticatedUser.id)
    .maybeSingle()

  const profileData = profile as { full_name: string | null; email: string } | null

  const agentRun = await getAgentRun(authenticatedUser.id)

  const userName =
    profileData?.full_name ?? profileData?.email ?? authenticatedUser.email ?? 'Utilisateur'

  return (
    // Pas de fond solide — on laisse passer le mesh + grille tech globaux
    // définis dans app/globals.css via body::before / body::after.
    <div className="relative flex h-screen overflow-hidden">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden lg:ml-64">
        <DashboardHeader
          userName={userName ?? 'Utilisateur'}
          agentRun={agentRun}
        />

        <main className="flex-1 overflow-y-auto">
          <div className="p-4 pb-24 sm:p-6 lg:pb-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
