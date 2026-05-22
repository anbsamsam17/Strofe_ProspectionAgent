// ============================================================
// /calendar — Vue calendrier des relances/rappels (FullCalendar)
//
// Sprint 3 retour client items #14 (vue calendrier), #15 (drag&drop),
// #17 (modif rappel depuis le calendrier).
//
// Server Component :
//   - Auth obligatoire (le layout dashboard redirect déjà mais on garde
//     une garde explicite pour les linters / cas edge).
//   - Fetch `prospect_exchanges` où `callback_date IS NOT NULL`
//     et `callback_done = false` (RLS implicite filtre user_id).
//   - Joint le prospect (raison_sociale, siren) via embedding Supabase.
//   - Résilient à la migration 014 manquante (callback_done) — fallback
//     comme `notifications/page.tsx`.
//   - Mapping vers un type `ExchangeEvent` plat passé au CC `CalendarView`.
//
// RGPD : pas de PII (email/téléphone) dans les events — seulement
// raison_sociale, type d'échange et date de rappel.
// ============================================================

import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { CalendarView, type ExchangeEvent } from '@/components/calendar/calendar-view'

export const dynamic = 'force-dynamic'

// ── Helpers résilients pour la migration 014 ─────────────────────────────────
// Copiés depuis app/(dashboard)/notifications/page.tsx (même pattern, isolé
// localement pour ne pas créer de dépendance entre deux pages d'apparence
// déconnectées).

function isCallbackDoneMissing(err: { code?: string; message?: string }): boolean {
  return (
    err.code === '42703' ||
    (err.message ?? '').toLowerCase().includes('callback_done')
  )
}

interface RawExchangeRow {
  id: string
  prospect_id: string
  occurred_at: string
  type: string
  notes: string | null
  callback_date: string | null
  callback_done?: boolean
  prospect:
    | { id: string; raison_sociale: string; siren: string | null }
    | { id: string; raison_sociale: string; siren: string | null }[]
    | null
}

// L'embedding Supabase peut renvoyer soit un objet (relation one-to-one du
// point de vue de la FK) soit un tableau (le typage par défaut). On normalise.
function pickProspect(
  raw: RawExchangeRow['prospect'],
): { id: string; raison_sociale: string; siren: string | null } | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

async function fetchEvents(): Promise<ExchangeEvent[]> {
  const supabase = await createClient()
  // database.types.ts pas regen post-migration 014 (callback_done) — cast
  // local vers SupabaseClient<any> (pattern déjà utilisé dans le projet,
  // cf. notifications/page.tsx).
  const sb = supabase as unknown as SupabaseClient

  // Tentative 1 : query nominal avec filtre `callback_done=false`.
  const queryWithFilter = await sb
    .from('prospect_exchanges')
    .select(
      'id, prospect_id, occurred_at, type, notes, callback_date, callback_done, prospect:prospects(id, raison_sociale, siren)',
    )
    .not('callback_date', 'is', null)
    .eq('callback_done', false)
    .order('callback_date', { ascending: true })

  let rows: RawExchangeRow[]

  if (queryWithFilter.error) {
    if (isCallbackDoneMissing(queryWithFilter.error)) {
      // Fallback : migration 014 pas appliquée — on filtre seulement sur
      // callback_date et on considère callback_done=false par défaut.
      const fallback = await sb
        .from('prospect_exchanges')
        .select(
          'id, prospect_id, occurred_at, type, notes, callback_date, prospect:prospects(id, raison_sociale, siren)',
        )
        .not('callback_date', 'is', null)
        .order('callback_date', { ascending: true })
      if (fallback.error) {
        // On log silencieusement (page calendrier non critique) et on
        // renvoie une liste vide plutôt que de planter.
        console.warn('[calendar] fetch fallback failed', fallback.error.message)
        return []
      }
      rows = (fallback.data ?? []) as RawExchangeRow[]
    } else {
      console.warn('[calendar] fetch failed', queryWithFilter.error.message)
      return []
    }
  } else {
    rows = (queryWithFilter.data ?? []) as RawExchangeRow[]
  }

  return rows.flatMap<ExchangeEvent>((row) => {
    if (!row.callback_date) return []
    const prospect = pickProspect(row.prospect)
    if (!prospect) return []
    return [
      {
        id: row.id,
        prospect_id: row.prospect_id,
        prospect_raison_sociale: prospect.raison_sociale,
        prospect_siren: prospect.siren,
        type: row.type,
        callback_date: row.callback_date,
        notes: row.notes,
      },
    ]
  })
}

export default async function CalendarPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const events = await fetchEvents()

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
          {'// Calendrier'}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Relances et rappels
        </h1>
        <p className="text-sm text-gray-400">
          Visualisez et déplacez vos rappels par jour. Cliquez sur un événement
          pour modifier l’échange. Glissez-déposez pour reprogrammer.
        </p>
      </header>

      <CalendarView events={events} />
    </div>
  )
}
