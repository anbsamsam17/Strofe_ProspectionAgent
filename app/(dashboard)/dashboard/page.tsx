import { redirect } from 'next/navigation'

// La page Dashboard a été supprimée : /prospects devient la home du dashboard.
// Ce Server Component préserve les anciens bookmarks et liens (emails, redirections post-login)
// en redirigeant vers /prospects.
export default function DashboardRedirectPage(): never {
  redirect('/prospects')
}
