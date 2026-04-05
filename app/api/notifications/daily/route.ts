// ============================================================
// GET /api/notifications/daily
// Envoi des emails de notification matin (cron 7h30).
// Protection : header Authorization: Bearer {CRON_SECRET} uniquement.
//
// Comportement :
//   1. Récupère toutes les daily_lists avec status='ready' pour aujourd'hui
//      dont la notification n'a pas encore été envoyée (notified_at IS NULL)
//   2. Pour chacune, récupère les 3 meilleurs items (topProspects pour l'email)
//   3. Appelle sendDailyReadyEmail() depuis lib/email/send.ts
//   4. Met à jour daily_lists.status = 'completed' + notified_at après envoi
//   5. Retourne { notified: number }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { sendDailyReadyEmail } from '@/lib/email/send'

export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// Helper : validation du secret cron (comparaison en temps constant)
// ------------------------------------------------------------

function isCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false

  const authHeader = request.headers.get('authorization') ?? ''
  const provided = authHeader.replace('Bearer ', '').trim()

  // Padding à longueur fixe pour éviter le leak de longueur via timing
  const expectedBuf = Buffer.from(cronSecret.padEnd(128, '\0'))
  const providedBuf = Buffer.from(provided.padEnd(128, '\0'))

  return timingSafeEqual(expectedBuf, providedBuf) && provided.length === cronSecret.length
}

// ------------------------------------------------------------
// Helper : formatage de la date pour l'affichage humain en email
// "2026-04-05" → "dimanche 5 avril 2026"
// ------------------------------------------------------------

function formatDateHuman(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`)
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  })
}

// ------------------------------------------------------------
// Handler GET
// ------------------------------------------------------------

export async function GET(request: NextRequest) {
  // -- Auth cron uniquement --
  if (!isCronRequest(request)) {
    return NextResponse.json(
      { error: 'Non autorisé', code: 'UNAUTHORIZED' },
      { status: 401 },
    )
  }

  const supabase = await createAdminClient()
  const today = new Date().toISOString().split('T')[0] // "YYYY-MM-DD"

  // Récupérer les listes prêtes non encore notifiées avec les items et prospects
  // (notified_at IS NULL = la notification email n'a pas encore été envoyée)
  const { data: lists, error: listsError } = await supabase
    .from('daily_lists')
    .select(
      `
      id,
      user_id,
      date,
      status,
      notified_at,
      profiles!inner (
        email,
        full_name,
        settings
      ),
      daily_list_items (
        ordre,
        priorite,
        prospect:prospects (
          raison_sociale,
          secteur_libelle,
          score_priorite
        )
      )
    `,
    )
    .eq('date', today)
    .eq('status', 'ready')
    .is('notified_at', null)
    .order('ordre', { referencedTable: 'daily_list_items', ascending: true })

  if (listsError) {
    console.log(
      JSON.stringify({
        level: 'error',
        route: '/api/notifications/daily',
        msg: 'Erreur récupération daily_lists',
        error: listsError.message,
        date: today,
      }),
    )
    return NextResponse.json(
      { error: 'Erreur base de données', code: 'DB_ERROR' },
      { status: 500 },
    )
  }

  if (!lists || lists.length === 0) {
    return NextResponse.json({ notified: 0 }, { status: 200 })
  }

  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? 'https://decarbonleads.strofe.fr'

  let notifiedCount = 0

  // Traiter chaque liste séquentiellement pour éviter de surcharger Resend
  for (const list of lists) {
    const profile = list.profiles as {
      email: string
      full_name: string | null
      settings: { notification_email?: string; daily_call_target?: number }
    } | null

    if (!profile?.email) {
      console.log(
        JSON.stringify({
          level: 'warn',
          route: '/api/notifications/daily',
          msg: 'Profil sans email — notification ignorée',
          list_id: list.id,
        }),
      )
      continue
    }

    const recipientEmail = profile.settings?.notification_email ?? profile.email
    const callTarget = profile.settings?.daily_call_target ?? 15

    // Construire la liste des 3 meilleurs prospects pour la preview email
    type ItemRow = {
      ordre: number
      priorite: string
      prospect: {
        raison_sociale: string
        secteur_libelle: string | null
        score_priorite: number
      } | null
    }

    const items = (list.daily_list_items as ItemRow[]) ?? []
    const topProspects = items
      .slice(0, 3)
      .filter((item) => item.prospect !== null)
      .map((item) => ({
        raison_sociale: item.prospect!.raison_sociale,
        secteur_libelle: item.prospect!.secteur_libelle ?? 'Secteur inconnu',
        priorite: item.priorite,
        score: item.prospect!.score_priorite,
      }))

    try {
      await sendDailyReadyEmail({
        to: recipientEmail,
        userName: profile.full_name ?? recipientEmail,
        date: formatDateHuman(list.date as string),
        callsCount: Math.min(items.length, callTarget),
        topProspects,
        appUrl: `${appBaseUrl}/dashboard/daily-list`,
      })

      // Marquer la notification comme envoyée + passer la liste en 'completed'
      const { error: updateError } = await supabase
        .from('daily_lists')
        .update({
          status: 'completed',
          notified_at: new Date().toISOString(),
        })
        .eq('id', list.id)

      if (updateError) {
        console.log(
          JSON.stringify({
            level: 'error',
            route: '/api/notifications/daily',
            msg: 'Impossible de mettre à jour la liste après notification',
            list_id: list.id,
            error: updateError.message,
          }),
        )
        // L'email a été envoyé mais la liste n'est pas marquée —
        // risque de double envoi au prochain cron si notified_at n'est pas mis à jour
        continue
      }

      notifiedCount++
    } catch (err) {
      console.log(
        JSON.stringify({
          level: 'error',
          route: '/api/notifications/daily',
          msg: 'Échec envoi email',
          list_id: list.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      // Non-fatal : on continue avec les autres utilisateurs
    }
  }

  console.log(
    JSON.stringify({
      level: 'info',
      route: '/api/notifications/daily',
      msg: 'Notifications envoyées',
      notified: notifiedCount,
      total: lists.length,
      date: today,
    }),
  )

  return NextResponse.json({ notified: notifiedCount }, { status: 200 })
}
