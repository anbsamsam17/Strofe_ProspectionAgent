import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/sidebar'
import { DashboardHeader } from '@/components/layout/dashboard-header'
import { PageTransition } from '@/components/layout/page-transition'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { ToastProvider } from '@/components/ui/toast'
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
    // ToastProvider monte au niveau dashboard pour que useToast() fonctionne
    // dans toutes les pages enfants (calendar, copy-email-button, etc.).
    // Pas de fond solide — on laisse passer le mesh + grille tech globaux
    // definis dans app/globals.css via body::before / body::after.
    <ToastProvider>
      <div className="relative flex h-screen overflow-hidden">
        <Sidebar />

        <div className="flex flex-1 flex-col overflow-hidden lg:ml-64">
          <DashboardHeader
            userName={userName ?? 'Utilisateur'}
            agentRun={agentRun}
            notificationBell={<NotificationBell />}
          />

          <main className="flex-1 overflow-y-auto">
            <div className="p-4 pb-24 sm:p-6 lg:pb-8">
              <PageTransition>{children}</PageTransition>
            </div>
          </main>
        </div>
      </div>
    </ToastProvider>
  )
}
