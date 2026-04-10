// ============================================================
// POST /api/daily-list/items
// Ajoute manuellement un prospect spécifique à la daily list du jour.
//
// Flux :
//   1. Auth Supabase + validation ownership du prospect
//   2. Récupère ou crée la daily list du jour
//   3. Vérifie que le prospect n'est pas déjà dans la liste
//   4. Enrichit les contacts si manquants (Pappers/Hunter)
//   5. Génère un pitch via genererPitch() (single)
//   6. Insère dans daily_list_items avec ordre = max + 1
//
// Auth : session Supabase obligatoire.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { genererPitch } from '@/lib/agent/pitch-gen'
import { enrichirContact } from '@/lib/agent/contact-enrichment'
import { determinerPriorite } from '@/lib/agent/scoring'
import type { DailyList, DailyListItem, Priority, ProfileSettings, Prospect } from '@/lib/types'
import type { Database } from '@/lib/supabase/database.types'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

// RFC 4122 strict — UUID version 1-5
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ItemsBodySchema = z.object({
  prospectId: z
    .string()
    .regex(UUID_REGEX, 'prospectId doit être un UUID RFC 4122 valide'),
})

// ------------------------------------------------------------
// HANDLER POST
// ------------------------------------------------------------

export async function POST(request: NextRequest) {
  // -- 1. Auth via session Supabase --
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      { error: 'Non authentifié', code: 'UNAUTHORIZED' },
      { status: 401 },
    )
  }

  // -- 2. Parsing + validation du body --
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Corps JSON invalide', code: 'INVALID_JSON' },
      { status: 400 },
    )
  }

  const parsed = ItemsBodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Paramètres invalides',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  const { prospectId } = parsed.data
  const supabaseAdmin = createAdminClient()

  // -- 3. Ownership check du prospect --
  const { data: prospectData, error: prospectError } = await supabaseAdmin
    .from('prospects')
    .select('*')
    .eq('id', prospectId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (prospectError) {
    console.log(
      JSON.stringify({
        level: 'error',
        module: 'api/daily-list/items',
        msg: 'Erreur DB lors du fetch prospect',
        user_id: user.id,
        prospect_id: prospectId,
        error: prospectError.message,
      }),
    )
    return NextResponse.json(
      { error: 'Erreur interne', code: 'DB_ERROR' },
      { status: 500 },
    )
  }

  if (!prospectData) {
    return NextResponse.json(
      { error: 'Prospect introuvable ou accès interdit', code: 'NOT_FOUND' },
      { status: 404 },
    )
  }

  const prospect = prospectData as unknown as Prospect

  // -- 4. Récupérer ou créer la daily list du jour --
  const today = new Date().toISOString().split('T')[0]

  const { data: listData, error: listError } = await supabaseAdmin
    .from('daily_lists')
    .upsert(
      {
        user_id: user.id,
        date: today,
        status: 'ready',
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,date' },
    )
    .select()
    .single()

  if (listError || !listData) {
    return NextResponse.json(
      { error: 'Impossible de récupérer la liste du jour', code: 'DB_ERROR' },
      { status: 500 },
    )
  }

  const dailyList = listData as DailyList

  // -- 5. Vérifier que le prospect n'est pas déjà dans la liste --
  const { data: existingItem } = await supabaseAdmin
    .from('daily_list_items')
    .select('id')
    .eq('daily_list_id', dailyList.id)
    .eq('prospect_id', prospectId)
    .maybeSingle()

  if (existingItem) {
    return NextResponse.json(
      {
        error: 'Ce prospect est déjà dans la liste du jour',
        code: 'ALREADY_IN_LIST',
        itemId: existingItem.id,
      },
      { status: 409 },
    )
  }

  // -- 6. Enrichissement contacts si manquants --
  if (!prospect.contact_email || !prospect.contact_telephone) {
    const existingContact = {
      contact_nom:       prospect.contact_nom ?? undefined,
      contact_prenom:    prospect.contact_prenom ?? undefined,
      contact_poste:     prospect.contact_poste ?? undefined,
      contact_telephone: prospect.contact_telephone ?? undefined,
      contact_email:     prospect.contact_email ?? undefined,
      contact_linkedin:  prospect.contact_linkedin ?? undefined,
    }

    try {
      const nouveauxChamps = await enrichirContact(prospect.siren, existingContact)

      if (Object.keys(nouveauxChamps).length > 0) {
        const updatePayload: Record<string, string | null> = {}
        for (const [key, value] of Object.entries(nouveauxChamps)) {
          updatePayload[key] = value ?? null
          ;(prospect as unknown as Record<string, unknown>)[key] = value ?? undefined
        }

        await supabaseAdmin
          .from('prospects')
          .update(updatePayload)
          .eq('id', prospect.id)
      }
    } catch (err) {
      // Non-fatal : on continue sans enrichissement
      console.log(
        JSON.stringify({
          level: 'warn',
          module: 'api/daily-list/items',
          msg: 'Enrichissement contact échoué — ajout sans contact enrichi',
          siren: prospect.siren,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }

  // -- 7. Charger les settings utilisateur pour le pitch --
  let settings: ProfileSettings = {
    daily_call_target: 15,
  }
  try {
    const { data: profileData } = await supabaseAdmin
      .from('profiles')
      .select('settings')
      .eq('id', user.id)
      .single()

    if (profileData?.settings) {
      settings = profileData.settings as unknown as ProfileSettings
    }
  } catch {
    // Continuer avec les settings par défaut
  }

  // -- 8. Générer le pitch (single, pas batch) --
  let pitch: Awaited<ReturnType<typeof genererPitch>> | null = null
  try {
    pitch = await genererPitch(prospect, settings)
  } catch (err) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'api/daily-list/items',
        msg: 'Génération pitch échouée — item inséré sans pitch',
        siren: prospect.siren,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }

  // -- 9. Récupérer le max ordre actuel --
  const { data: lastOrdreData } = await supabaseAdmin
    .from('daily_list_items')
    .select('ordre')
    .eq('daily_list_id', dailyList.id)
    .order('ordre', { ascending: false })
    .limit(1)

  const lastOrdre = lastOrdreData && lastOrdreData.length > 0
    ? (lastOrdreData[0] as { ordre: number }).ordre
    : 0

  // -- 10. Insérer le daily_list_item --
  const priority: Priority = determinerPriorite(prospect.score_priorite)

  type DailyListInsert = {
    daily_list_id: string
    user_id: string
    prospect_id: string
    ordre: number
    priorite: Priority
    meilleur_creneau: string
    accroche: string
    pitch: string
    signaux_detectes: DailyListItem['signaux_detectes']
    objections_reponses: DailyListItem['objections_reponses']
    contact_type: DailyListItem['contact_type']
    call_result: null
    callback_date: null
    call_notes: null
    called_at: null
  }

  const newItem: DailyListInsert = {
    daily_list_id: dailyList.id,
    user_id: user.id,
    prospect_id: prospectId,
    ordre: lastOrdre + 1,
    priorite: priority,
    meilleur_creneau: pitch?.meilleur_creneau ?? '10h-11h',
    accroche: pitch?.accroche ?? '',
    pitch: pitch?.pitch ?? '',
    signaux_detectes: prospect.signaux ?? [],
    objections_reponses: pitch?.objections ?? [],
    contact_type: pitch?.contact_type ?? 'rse',
    call_result: null,
    callback_date: null,
    call_notes: null,
    called_at: null,
  }

  const { data: insertedItem, error: insertError } = await supabaseAdmin
    .from('daily_list_items')
    .insert(newItem as unknown as Database['public']['Tables']['daily_list_items']['Insert'])
    .select('id')
    .single()

  if (insertError || !insertedItem) {
    console.log(
      JSON.stringify({
        level: 'error',
        module: 'api/daily-list/items',
        msg: 'Impossible d\'insérer le daily_list_item',
        user_id: user.id,
        prospect_id: prospectId,
        error: insertError?.message ?? 'data null',
      }),
    )
    return NextResponse.json(
      { error: 'Impossible d\'insérer le prospect dans la liste', code: 'DB_ERROR' },
      { status: 500 },
    )
  }

  console.log(
    JSON.stringify({
      level: 'info',
      module: 'api/daily-list/items',
      event: 'item_added_manually',
      user_id: user.id,
      prospect_id: prospectId,
      daily_list_id: dailyList.id,
      item_id: (insertedItem as { id: string }).id,
    }),
  )

  return NextResponse.json(
    {
      success: true,
      itemId: (insertedItem as { id: string }).id,
    },
    { status: 201 },
  )
}
