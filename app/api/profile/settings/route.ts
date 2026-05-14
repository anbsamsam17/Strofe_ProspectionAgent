import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'
import type { ProfileSettings } from '@/lib/types'
import { normalizeScoringWeights } from '@/lib/agent/scoring'

// ── Validation Zod stricte ───────────────────────────────────────────────────

const ScoringWeightsSchema = z.object({
  taille: z.number().min(0).max(100),
  beges: z.number().min(0).max(100),
  contact: z.number().min(0).max(100),
})

const SettingsSchema = z.object({
  offer_description: z.string().max(2000).optional(),
  target_sectors: z.array(z.string().max(50)).max(20).optional(),
  target_city: z.string().max(100).optional(),
  target_postal_codes: z.array(z.string().regex(/^\d{5}$/)).max(10).optional(),
  daily_call_target: z.number().int().min(1).max(30).optional(),
  notification_email: z.string().email().max(200).optional(),
  scoring_weights: ScoringWeightsSchema.optional(),
})

// ── PATCH /api/profile/settings ───────────────────────────────────────────────

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()

    // Authentification
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    // Parsing + validation Zod stricte
    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Corps JSON invalide' },
        { status: 400 }
      )
    }

    const parsed = SettingsSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Paramètres invalides',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 422 }
      )
    }

    const payload = parsed.data

    // Récupération du profil existant pour merge des settings
    const { data: existingProfile, error: fetchError } = await supabase
      .from('profiles')
      .select('settings')
      .eq('id', user.id)
      .single()

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('[settings] Fetch error:', fetchError)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération du profil' },
        { status: 500 }
      )
    }

    const currentSettings = ((existingProfile as { settings?: Json } | null)?.settings ?? {}) as Partial<ProfileSettings>

    // Merge des settings (on ne remplace que les clés fournies)
    const updatedSettings: ProfileSettings = {
      daily_call_target: currentSettings.daily_call_target ?? 15,
      target_sectors: currentSettings.target_sectors ?? [],
      target_city: currentSettings.target_city ?? '',
      offer_description: currentSettings.offer_description ?? '',
      notification_email: currentSettings.notification_email,
      target_postal_codes: currentSettings.target_postal_codes,
      scoring_weights: currentSettings.scoring_weights,
      // Merge avec payload — chaque champ validé par Zod est appliqué si présent
      ...(payload.offer_description !== undefined && {
        offer_description: payload.offer_description,
      }),
      ...(payload.target_sectors !== undefined && {
        target_sectors: payload.target_sectors,
      }),
      ...(payload.target_city !== undefined && {
        target_city: payload.target_city,
      }),
      ...(payload.daily_call_target !== undefined && {
        daily_call_target: payload.daily_call_target,
      }),
      // Champs précédemment absents du merge — ajoutés pour IMP-03 / BUG-05
      ...(payload.notification_email !== undefined && {
        notification_email: payload.notification_email,
      }),
      ...(payload.target_postal_codes !== undefined && {
        target_postal_codes: payload.target_postal_codes,
      }),
      // Pondération scoring — normalisée à 100 avant persistance (cf. migration 013)
      ...(payload.scoring_weights !== undefined && {
        scoring_weights: normalizeScoringWeights(payload.scoring_weights),
      }),
    }

    // Mise à jour du profil (UPDATE uniquement — le profil est créé par trigger auth)
    // Cast via unknown pour contourner le type strict Json de Supabase sans perdre
    // la type-safety (as unknown as Json est préférable à as any)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        settings: updatedSettings as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (updateError) {
      console.error('[settings] Update error:', updateError)
      return NextResponse.json(
        { error: 'Erreur lors de la sauvegarde des paramètres' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        data: updatedSettings,
        message: 'Paramètres sauvegardés avec succès',
      },
      { status: 200 }
    )
  } catch (err) {
    console.error('[settings] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}
