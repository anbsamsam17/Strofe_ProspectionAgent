import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

// Compte les relances dues dans les 7 prochains jours (non traitées).
// Utilisé pour le badge rouge sur la cloche.
async function getPendingCallbackCount(): Promise<number> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return 0

  // Migration 014 ajoute `callback_done` mais `database.types.ts` n'a pas
  // encore ete regenere — cast local pour unblocker le type-check.
  const sb = supabase as unknown as SupabaseClient

  const now = new Date()
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const { count } = await sb
    .from('prospect_exchanges')
    .select('id', { count: 'exact', head: true })
    .not('callback_date', 'is', null)
    .eq('callback_done', false)
    .lte('callback_date', inSevenDays.toISOString())

  return count ?? 0
}

// Server Component : le badge est rendu côté serveur à chaque refresh du layout.
// Pas de 'use client' — aucun état ni event handler.
export async function NotificationBell() {
  const count = await getPendingCallbackCount()
  const hasNotifications = count > 0
  // Clamper le badge à 99+ pour éviter les débordements visuels.
  const badgeLabel = count > 99 ? '99+' : String(count)

  return (
    <Link
      href="/notifications"
      aria-label={
        hasNotifications
          ? `Notifications — ${count} relance${count > 1 ? 's' : ''} en attente`
          : 'Notifications — aucune relance en attente'
      }
      className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400/60 focus-visible:ring-offset-1 focus-visible:ring-offset-black/40"
    >
      {/* Icône cloche — path SVG lucide-react Bell inline */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>

      {hasNotifications && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 font-mono text-[9px] font-bold leading-none text-white shadow-[0_0_8px_oklch(55%_0.22_25_/_0.7)]"
        >
          {badgeLabel}
        </span>
      )}
    </Link>
  )
}
