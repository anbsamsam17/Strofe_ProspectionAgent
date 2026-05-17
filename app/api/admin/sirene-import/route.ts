// ============================================================
// POST /api/admin/sirene-import
//
// Wrapper d'orchestration pour l'ETL bulk SIRENE.
//
// CONTEXTE / TRADE-OFF :
//   L'import bulk SIRENE (15-30 min sur 1.5 M de SIRET actifs) dépasse
//   largement le `maxDuration` Vercel (Hobby 60s, Pro 300s, Pro étendu
//   800s). On NE PEUT PAS exécuter l'ETL réel ici — il doit être lancé
//   par :
//     - `npm run import-sirene` (local / dev)
//     - GitHub Actions (`.github/workflows/sirene-import.yml`)
//
//   Cette route sert donc UNIQUEMENT à :
//     1. Sanity-check de l'auth CRON_SECRET (avant le job GH Actions).
//     2. Lecture du status pré-import via la vue `sirene_cache_size`.
//     3. Retour d'instructions claires pour le déclenchement effectif.
//
//   Pas de background `setTimeout` / `waitUntil` : Vercel termine la
//   lambda avec la requête, donc tout travail "en arrière-plan" depuis
//   ici serait perdu.
//
// SÉCURITÉ :
//   - Bearer CRON_SECRET timing-safe (via `isCronRequest`).
//   - Service role utilisé pour bypass RLS sur la vue de monitoring.
//   - Aucun secret loggé.
//
// TYPAGE :
//   La vue `sirene_cache_size` (migration 019) n'est pas encore régénérée
//   dans `lib/supabase/database.types.ts`. On caste le client en
//   `SupabaseClient<any>` localement pour pouvoir interroger la vue
//   avec un type de row explicite — pas de `as any` sur les valeurs.
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isCronRequest } from '@/lib/auth/cron'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
// Vercel Pro max ; insuffisant pour 15-30 min mais on n'exécute pas l'ETL ici.
export const maxDuration = 800

/** Row de la vue `sirene_cache_size` (migration 019, pas encore régénérée). */
type SireneCacheSizeRow = {
  total_size: string | null
  total_bytes: number | null
  active_count: number | null
  last_import_at: string | null
}

export async function POST(req: NextRequest) {
  // 1. Auth cron (CRON_SECRET timing-safe).
  if (!isCronRequest(req)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Cron secret invalide' } },
      { status: 401 },
    )
  }

  // 2. Lecture du status courant — sert de baseline pour l'opérateur
  //    qui va déclencher l'ETL effectif (GH Actions / local).
  //    Cast vers SupabaseClient<any> nécessaire car la vue n'est pas
  //    encore dans les types générés (migration 019 trop récente).
  const supabase = createAdminClient() as unknown as SupabaseClient
  const { data: sizeBefore, error: selectError } = await supabase
    .from('sirene_cache_size')
    .select('total_size, total_bytes, active_count, last_import_at')
    .single<SireneCacheSizeRow>()

  if (selectError) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: selectError.message } },
      { status: 500 },
    )
  }

  // 3. Log structuré (pas de PII, juste métriques de taille).
  console.log(
    JSON.stringify({
      level: 'info',
      module: 'admin/sirene-import',
      msg: 'Pré-import status lu — ETL doit être déclenché hors Vercel',
      total_bytes: sizeBefore?.total_bytes ?? null,
      active_count: sizeBefore?.active_count ?? null,
      last_import_at: sizeBefore?.last_import_at ?? null,
    }),
  )

  // 4. Réponse JSON avec instructions de déclenchement effectif.
  return NextResponse.json(
    {
      data: {
        message:
          "ETL doit etre lance via GitHub Actions ou en local. Vercel timeout 800s insuffisant pour 15-30min d'import bulk SIRENE.",
        current_status: sizeBefore,
        command_local: 'npm run import-sirene',
        command_gh_actions: 'gh workflow run sirene-import.yml',
      },
    },
    { status: 200 },
  )
}
