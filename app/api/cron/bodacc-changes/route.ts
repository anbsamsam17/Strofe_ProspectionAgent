// ============================================================
// POST /api/cron/bodacc-changes
// Watcher hebdomadaire BODACC : détecte les changements de dirigeants
// pour invalider les contacts obsolètes (`prospects.contact_outdated_at`).
//
// Fréquence recommandée (à ajouter manuellement dans `vercel.json`) :
//   { "path": "/api/cron/bodacc-changes", "schedule": "0 4 * * 1" }
//   → lundi 04h00 UTC (hors fenêtre des autres crons).
//
// Sécurité :
// - Bearer CRON_SECRET timing-safe (`isCronRequest`).
// - Service role : bypass RLS pour scanner tous les prospects actifs.
// - Aucun nom de dirigeant loggé (RGPD — données publiques mais on garde
//   le principe de minimisation des logs).
//
// Idempotent : `contact_outdated_at = NOW()` est ré-appliqué sans danger.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isCronRequest } from '@/lib/auth/cron'
import { fetchBodaccChanges } from '@/lib/agent/sources/bodacc'

// Vercel : le scan peut prendre quelques minutes selon le nombre de prospects.
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// Taille de batch pour les appels BODACC. Endpoint public donc on évite
// d'envoyer des `where in (...)` géants — 50 SIREN/requête est confortable.
const SIREN_BATCH_SIZE = 50

// Période de scan : 7 jours = un cron hebdomadaire. On chevauche légèrement
// (8 jours) pour ne pas perdre d'annonce publiée entre deux passes (latence
// possible côté BODACC).
const SCAN_WINDOW_DAYS = 8

interface ProspectRow {
  id: string
  siren: string | null
  user_id: string
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Cron secret invalide' } },
      { status: 401 },
    )
  }

  const supabaseAdmin = createAdminClient()

  // 1. Récupérer tous les SIREN actifs (non archivés) avec leur user_id.
  const { data: prospects, error: selectErr } = await supabaseAdmin
    .from('prospects')
    .select('id, siren, user_id')
    .is('archived_at', null)
    .not('siren', 'is', null)

  if (selectErr) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: selectErr.message } },
      { status: 500 },
    )
  }

  const rows = (prospects ?? []) as ProspectRow[]
  const sirenToUser = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!row.siren) continue
    const set = sirenToUser.get(row.siren) ?? new Set<string>()
    set.add(row.user_id)
    sirenToUser.set(row.siren, set)
  }

  const allSirens = Array.from(sirenToUser.keys())
  const usersProcessed = new Set<string>()
  rows.forEach((r) => usersProcessed.add(r.user_id))

  if (allSirens.length === 0) {
    return NextResponse.json(
      { data: { changes: 0, users_processed: 0, sirens_checked: 0 } },
      { status: 200 },
    )
  }

  // 2. Appeler BODACC par batches de 50, séquentiellement (endpoint public
  // gratuit — on évite de paralléliser pour rester poli).
  const since = new Date(Date.now() - SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const batches = chunk(allSirens, SIREN_BATCH_SIZE)

  let changesDetected = 0
  const sirensToInvalidate = new Set<string>()

  for (const batch of batches) {
    const changes = await fetchBodaccChanges(batch, { since })
    for (const change of changes) {
      sirensToInvalidate.add(change.siren)
      changesDetected += 1
    }
  }

  // 3. Marquer les prospects concernés. On itère SIREN par SIREN car un même
  // SIREN peut appartenir à plusieurs users (tracking par user_id obligatoire
  // — pas d'UPDATE global qui casserait l'isolation entre tenants).
  const nowIso = new Date().toISOString()
  let updatedCount = 0

  for (const siren of sirensToInvalidate) {
    const users = sirenToUser.get(siren)
    if (!users) continue

    for (const userId of users) {
      // `contact_outdated_at` est ajouté par la migration 015_enrichment_v2.sql
      // mais `database.types.ts` n'a pas été régénéré (npx supabase gen types)
      // — cast scopé en attendant la régénération.
      const updatePayload = { contact_outdated_at: nowIso } as unknown as Record<string, string>
      const { error: updateErr } = await supabaseAdmin
        .from('prospects')
        .update(updatePayload)
        .eq('siren', siren)
        .eq('user_id', userId)

      if (updateErr) {
        // On loggue mais on ne fail pas le batch entier — un user en erreur
        // ne doit pas bloquer les autres.
        console.log(
          JSON.stringify({
            level: 'warn',
            module: 'api/cron/bodacc-changes',
            msg: 'UPDATE contact_outdated_at failed',
            siren,
            error: updateErr.message,
          }),
        )
        continue
      }
      updatedCount += 1
    }
  }

  // 4. Log structuré final — pas de noms, pas de PII.
  console.log(
    JSON.stringify({
      level: 'info',
      module: 'api/cron/bodacc-changes',
      msg: 'BODACC weekly scan completed',
      users_processed: usersProcessed.size,
      sirens_checked: allSirens.length,
      changes_detected: changesDetected,
      prospects_updated: updatedCount,
    }),
  )

  return NextResponse.json(
    {
      data: {
        changes: changesDetected,
        users_processed: usersProcessed.size,
        sirens_checked: allSirens.length,
        prospects_updated: updatedCount,
      },
    },
    { status: 200 },
  )
}
