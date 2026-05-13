import { redirect } from 'next/navigation'

// La page "Liste du jour" a été supprimée de la navigation principale.
// Ce Server Component préserve les anciens bookmarks et liens externes (emails Resend)
// en redirigeant vers /prospects, qui est désormais la home du dashboard.
export default function DailyListRedirectPage(): never {
  redirect('/prospects')
}
