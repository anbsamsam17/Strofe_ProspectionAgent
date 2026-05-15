import { type NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { isCronRequest } from '@/lib/auth/cron'

// ============================================================
// Cron : purge des prospects au-delà de 3 ans
//
// Conformité RGPD — durée de conservation proportionnée (CNIL).
// Supprime les prospects dont :
//   - `last_enrichment_run_at < now() - 3 ans` (a été enrichi mais plus jamais touché)
//   - OU `last_enrichment_run_at IS NULL AND created_at < now() - 3 ans`
//     (jamais ré-enrichi, créé il y a plus de 3 ans)
//
// CASCADE : prospect_contacts, prospect_exchanges, prospect_notes
// sont supprimés via FK ON DELETE CASCADE.
//
// Fréquence recommandée (à ajouter à vercel.json) : "0 3 * * *" (quotidien 3h).
// Limite Hobby Vercel = 1 cron/jour : à arbitrer avec les autres crons.
// ============================================================

export const dynamic = 'force-dynamic'

const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  if (!isCronRequest(req)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Cron secret invalide' } },
      { status: 401 },
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: { code: 'CONFIG', message: 'Supabase env manquantes' } },
      { status: 500 },
    )
  }

  const supabase = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const cutoffIso = new Date(Date.now() - THREE_YEARS_MS).toISOString()

  // Compter avant de supprimer (visibilité + safe rollback si > seuil anormal)
  const { count: toDeleteCount, error: countErr } = await supabase
    .from('prospects')
    .select('id', { count: 'exact', head: true })
    .or(
      `last_enrichment_run_at.lt.${cutoffIso},and(last_enrichment_run_at.is.null,created_at.lt.${cutoffIso})`,
    )

  if (countErr) {
    console.error(
      JSON.stringify({
        module: 'purge-prospects',
        phase: 'count',
        error: countErr.message,
      }),
    )
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Comptage échec' } },
      { status: 500 },
    )
  }

  if ((toDeleteCount ?? 0) === 0) {
    console.log(
      JSON.stringify({ module: 'purge-prospects', deleted: 0, cutoffIso }),
    )
    return NextResponse.json({ data: { deleted: 0 } }, { status: 200 })
  }

  const { error: deleteErr } = await supabase
    .from('prospects')
    .delete()
    .or(
      `last_enrichment_run_at.lt.${cutoffIso},and(last_enrichment_run_at.is.null,created_at.lt.${cutoffIso})`,
    )

  if (deleteErr) {
    console.error(
      JSON.stringify({
        module: 'purge-prospects',
        phase: 'delete',
        error: deleteErr.message,
      }),
    )
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Suppression échec' } },
      { status: 500 },
    )
  }

  const deleted = toDeleteCount ?? 0
  console.log(
    JSON.stringify({ module: 'purge-prospects', deleted, cutoffIso }),
  )

  return NextResponse.json({ data: { deleted } }, { status: 200 })
}
