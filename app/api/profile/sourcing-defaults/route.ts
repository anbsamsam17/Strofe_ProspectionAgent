// ============================================================
// GET /api/profile/sourcing-defaults
// Renvoie les valeurs par défaut pour pré-remplir la modal de sourcing.
// Lit `profiles.settings` (JSONB libre) côté SSR — RLS filtre implicitement
// par auth.uid(). Aucune écriture, lecture pure.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Non authentifié' } },
      { status: 401 },
    )
  }

  // RLS implicite via session SSR — pas de filtre user_id manuel.
  // (.eq('id', user.id) cible la PK du profil, pas une vérification de propriété.)
  const { data, error } = await supabase
    .from('profiles')
    .select('settings')
    .eq('id', user.id)
    .single()

  if (error) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  // Le JSONB `settings` peut contenir des champs additionnels (region,
  // effectif_min/max) au-delà du type strict ProfileSettings — on traite
  // comme Record<string, unknown> et on narrowe défensivement.
  const s = (data?.settings ?? {}) as Record<string, unknown>

  return NextResponse.json({
    data: {
      targetSectors: Array.isArray(s.target_sectors) ? s.target_sectors : [],
      targetRegion: typeof s.region === 'string' ? s.region : '',
      effectifMin: typeof s.effectif_min === 'number' ? s.effectif_min : null,
      effectifMax: typeof s.effectif_max === 'number' ? s.effectif_max : null,
    },
  })
}
