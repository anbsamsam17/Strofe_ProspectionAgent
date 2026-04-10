// ============================================================
// DAILY LIST GENERATOR — Agent IA Prospection Bilan Carbone
// Orchestrateur de génération de la liste quotidienne :
//   1. Récupère ou crée la daily list du jour
//   2. Supprime les items non appelés (garde les appelés)
//   3. Sélectionne les TOP N prospects par score
//   4. Enrichit les contacts UNIQUEMENT sur ces N prospects (Pappers/Hunter)
//   5. Génère les pitchs GPT-4o pour ces N prospects
//   6. Insère les daily_list_items
//   7. Passe la liste en status 'ready'
//
// Idempotent : relancer 2x ne crée pas de doublons.
// ============================================================

import type { Database, Json } from '@/lib/supabase/database.types'
import type { SupabaseAdminClient } from '@/lib/supabase/server'
import type {
  AgentLog,
  DailyList,
  DailyListItem,
  GeneratedPitch,
  Priority,
  ProfileSettings,
  Prospect,
} from '@/lib/types'
import { genererPitchsBatch } from './pitch-gen'
import { enrichirContact, getCreditsUsed } from './contact-enrichment'
import { determinerPriorite } from './scoring'

// ------------------------------------------------------------
// TYPES PUBLICS
// ------------------------------------------------------------

export interface GenerateParams {
  /** Nombre de prospects à sélectionner pour la liste du jour (défaut : 15) */
  targetCount?: number
}

export interface GenerateResult {
  dailyListId: string
  itemsAdded: number
  /** Items non appelés supprimés avant la régénération */
  itemsReplaced: number
  duration_ms: number
}

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

const DEFAULT_TARGET_COUNT = 15
const SCORE_QUALIFICATION_SEUIL = 20

// ------------------------------------------------------------
// LOGGING STRUCTURÉ (JSON)
// ------------------------------------------------------------

function log(
  correlationId: string,
  userId: string,
  phase: string,
  message: string,
  level: 'info' | 'warn' | 'error',
  data?: Record<string, unknown>,
): AgentLog {
  const entry: AgentLog = {
    timestamp: new Date().toISOString(),
    phase,
    message,
    level,
    data,
  }

  console.log(
    JSON.stringify({
      ...entry,
      correlation_id: correlationId,
      user_id: userId,
      module: 'daily-list-generator',
    }),
  )

  return entry
}

// ------------------------------------------------------------
// GÉNÉRATEUR DE DAILY LIST
// ------------------------------------------------------------

/**
 * Génère (ou régénère) la liste quotidienne pour un utilisateur.
 *
 * @param userId        - ID Supabase Auth de l'utilisateur (UUID)
 * @param supabaseAdmin - Client Supabase service_role (bypass RLS)
 * @param params        - Paramètres de génération (targetCount)
 */
export async function generateDailyList(
  userId: string,
  supabaseAdmin: SupabaseAdminClient,
  params: GenerateParams = {},
): Promise<GenerateResult> {
  const startedAt = new Date()
  const correlationId = crypto.randomUUID()
  const targetCount = params.targetCount ?? DEFAULT_TARGET_COUNT
  const logs: AgentLog[] = []

  logs.push(log(correlationId, userId, 'generate_init', 'Génération daily list démarrée', 'info', {
    targetCount,
  }))

  // --------------------------------------------------------
  // STEP 1 : Charger les settings utilisateur (pour les pitchs)
  // --------------------------------------------------------
  let settings: ProfileSettings = { daily_call_target: targetCount }
  try {
    const { data: profileData } = await supabaseAdmin
      .from('profiles')
      .select('settings')
      .eq('id', userId)
      .single()

    if (profileData?.settings) {
      settings = profileData.settings as unknown as ProfileSettings
    }
  } catch {
    logs.push(log(correlationId, userId, 'generate_init', 'Settings introuvables — paramètres par défaut utilisés', 'warn'))
  }

  // --------------------------------------------------------
  // STEP 2 : Récupérer ou créer la daily list du jour
  // --------------------------------------------------------
  const today = new Date().toISOString().split('T')[0] // "YYYY-MM-DD"

  const { data: listData, error: listError } = await supabaseAdmin
    .from('daily_lists')
    .upsert(
      {
        user_id: userId,
        date: today,
        status: 'generating',
        generated_at: null,
      },
      { onConflict: 'user_id,date' },
    )
    .select()
    .single()

  if (listError || !listData) {
    throw new Error(
      `generateDailyList: impossible de créer/récupérer la daily_list — ${listError?.message ?? 'data null'}`,
    )
  }

  const dailyList = listData as DailyList
  logs.push(log(correlationId, userId, 'generate_init', `Daily list du ${today} prête (id: ${dailyList.id})`, 'info'))

  // --------------------------------------------------------
  // STEP 3 : Supprimer les items NON appelés
  // (conserver ceux avec called_at IS NOT NULL)
  // --------------------------------------------------------
  const { data: pendingItems, error: pendingError } = await supabaseAdmin
    .from('daily_list_items')
    .select('id')
    .eq('daily_list_id', dailyList.id)
    .is('called_at', null)

  if (pendingError) {
    logs.push(log(correlationId, userId, 'generate_cleanup', 'Impossible de compter les items non appelés', 'warn', {
      error: pendingError.message,
    }))
  }

  const pendingCount = (pendingItems ?? []).length
  const itemsReplaced = pendingCount

  if (pendingCount > 0) {
    const { error: deleteError } = await supabaseAdmin
      .from('daily_list_items')
      .delete()
      .eq('daily_list_id', dailyList.id)
      .is('called_at', null)

    if (deleteError) {
      logs.push(log(correlationId, userId, 'generate_cleanup', `Erreur suppression items non appelés : ${deleteError.message}`, 'warn'))
    } else {
      logs.push(log(correlationId, userId, 'generate_cleanup', `${pendingCount} items non appelés supprimés`, 'info'))
    }
  }

  // Récupérer les prospect_ids déjà appelés (à exclure de la sélection)
  const { data: calledItems } = await supabaseAdmin
    .from('daily_list_items')
    .select('prospect_id')
    .eq('daily_list_id', dailyList.id)
    .not('called_at', 'is', null)

  const alreadyCalledIds = (calledItems ?? []).map(
    (row: { prospect_id: string }) => row.prospect_id,
  )

  logs.push(log(correlationId, userId, 'generate_cleanup', `${alreadyCalledIds.length} prospects déjà appelés (conservés)`, 'info'))

  // --------------------------------------------------------
  // STEP 4 : Sélectionner les TOP N prospects
  // Critères :
  //   - user_id = userId
  //   - statut IN ('sourced', 'qualified')
  //   - beges_publie = false OR beges_valide = false
  //   - NOT IN (alreadyCalledIds)
  //   - ORDER BY score_priorite DESC
  //   - LIMIT targetCount
  // --------------------------------------------------------
  let selectQuery = supabaseAdmin
    .from('prospects')
    .select('*')
    .eq('user_id', userId)
    .in('statut', ['sourced', 'qualified'])
    .or('beges_publie.eq.false,beges_valide.eq.false')
    .order('score_priorite', { ascending: false })
    .limit(targetCount)

  if (alreadyCalledIds.length > 0) {
    selectQuery = selectQuery.not('id', 'in', `(${alreadyCalledIds.join(',')})`)
  }

  const { data: prospectsData, error: selectError } = await selectQuery

  if (selectError) {
    throw new Error(
      `generateDailyList: sélection prospects échouée — ${selectError.message}`,
    )
  }

  const selectedProspects = (prospectsData ?? []) as unknown as Prospect[]

  logs.push(log(correlationId, userId, 'generate_selection', `${selectedProspects.length} prospects sélectionnés (objectif: ${targetCount})`, 'info'))

  if (selectedProspects.length === 0) {
    logs.push(log(correlationId, userId, 'generate_selection', 'Aucun prospect disponible — lancer un sourcing pour alimenter le pipeline', 'warn'))

    // Remettre la liste en 'ready' quand même (liste vide mais valide)
    await supabaseAdmin
      .from('daily_lists')
      .update({ status: 'ready', generated_at: new Date().toISOString() })
      .eq('id', dailyList.id)

    return {
      dailyListId: dailyList.id,
      itemsAdded: 0,
      itemsReplaced,
      duration_ms: Date.now() - startedAt.getTime(),
    }
  }

  // --------------------------------------------------------
  // STEP 5 : Enrichissement contacts UNIQUEMENT sur ces N prospects
  // Phase NON-FATALE — pas bloquante si Pappers/Hunter indisponibles.
  // --------------------------------------------------------
  const prospectsToEnrich = selectedProspects.filter(
    (p) => !p.contact_email || !p.contact_telephone,
  )

  if (prospectsToEnrich.length > 0) {
    logs.push(log(correlationId, userId, 'generate_enrich', `Enrichissement contacts pour ${prospectsToEnrich.length} prospects`, 'info'))

    let enrichis = 0

    // Séquentiel pour préserver les quotas des APIs gratuites
    for (const prospect of prospectsToEnrich) {
      const existingContact = {
        contact_nom:       prospect.contact_nom ?? undefined,
        contact_prenom:    prospect.contact_prenom ?? undefined,
        contact_poste:     prospect.contact_poste ?? undefined,
        contact_telephone: prospect.contact_telephone ?? undefined,
        contact_email:     prospect.contact_email ?? undefined,
        contact_linkedin:  prospect.contact_linkedin ?? undefined,
      }

      let nouveauxChamps: Partial<typeof existingContact>
      try {
        nouveauxChamps = await enrichirContact(prospect.siren, existingContact)
      } catch (err) {
        logs.push(log(correlationId, userId, 'generate_enrich', `Erreur enrichissement SIREN ${prospect.siren}`, 'warn', {
          siren: prospect.siren,
          error: err instanceof Error ? err.message : String(err),
        }))
        continue
      }

      if (Object.keys(nouveauxChamps).length === 0) continue

      // Mettre à jour en DB ET mettre à jour l'objet en mémoire pour le pitch
      const updatePayload: Record<string, string | null> = {}
      for (const [key, value] of Object.entries(nouveauxChamps)) {
        updatePayload[key] = value ?? null
        // Mise à jour en mémoire pour que genererPitchsBatch bénéficie des nouvelles données
        ;(prospect as unknown as Record<string, unknown>)[key] = value ?? undefined
      }

      const { error: updateError } = await supabaseAdmin
        .from('prospects')
        .update(updatePayload)
        .eq('id', prospect.id)

      if (updateError) {
        logs.push(log(correlationId, userId, 'generate_enrich', `Impossible de mettre à jour le contact SIREN ${prospect.siren}`, 'warn', {
          siren: prospect.siren,
          error: updateError.message,
        }))
        continue
      }

      enrichis++
    }

    const credits = getCreditsUsed()
    logs.push(log(correlationId, userId, 'generate_enrich', `Enrichissement terminé`, 'info', {
      prospects_enrichis: enrichis,
      prospects_analyses: prospectsToEnrich.length,
      credits_pappers: credits.pappers,
      credits_hunter: credits.hunter,
    }))
  } else {
    logs.push(log(correlationId, userId, 'generate_enrich', 'Tous les prospects sélectionnés ont déjà un contact complet', 'info'))
  }

  // --------------------------------------------------------
  // STEP 6 : Génération des pitchs GPT-4o
  // --------------------------------------------------------
  logs.push(log(correlationId, userId, 'generate_pitchs', `Génération de ${selectedProspects.length} pitchs via GPT-4o`, 'info'))

  let pitchs: GeneratedPitch[] = []
  try {
    pitchs = await genererPitchsBatch(selectedProspects, settings)
    logs.push(log(correlationId, userId, 'generate_pitchs', `${pitchs.length} pitchs générés`, 'info'))
  } catch (err) {
    // Non-fatal : le batch gère les erreurs individuelles avec des pitchs fallback
    logs.push(log(correlationId, userId, 'generate_pitchs', 'Génération pitchs partiellement échouée — pitchs fallback utilisés', 'warn', {
      error: err instanceof Error ? err.message : String(err),
    }))
  }

  if (pitchs.length < selectedProspects.length) {
    logs.push(log(correlationId, userId, 'generate_pitchs', 'ATTENTION : pitchs.length < prospects.length — certains items auront des pitchs vides', 'warn', {
      pitchs_count: pitchs.length,
      prospects_count: selectedProspects.length,
      manquants: selectedProspects.length - pitchs.length,
    }))
  }

  // --------------------------------------------------------
  // STEP 7 : Récupérer le dernier ordre pour continuer la numérotation
  // --------------------------------------------------------
  const { data: existingOrderItems } = await supabaseAdmin
    .from('daily_list_items')
    .select('ordre')
    .eq('daily_list_id', dailyList.id)
    .order('ordre', { ascending: false })
    .limit(1)

  const lastOrdre = existingOrderItems && existingOrderItems.length > 0
    ? (existingOrderItems[0] as { ordre: number }).ordre
    : 0

  // --------------------------------------------------------
  // STEP 8 : Insérer les daily_list_items
  // --------------------------------------------------------
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

  const items: DailyListInsert[] = selectedProspects.map((prospect, index) => {
    const pitch = pitchs[index]
    const priority: Priority = determinerPriorite(prospect.score_priorite)

    return {
      daily_list_id: dailyList.id,
      user_id: userId,
      prospect_id: prospect.id,
      ordre: lastOrdre + index + 1,
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
  })

  const { error: insertError } = await supabaseAdmin
    .from('daily_list_items')
    .insert(items as unknown as Database['public']['Tables']['daily_list_items']['Insert'][])

  if (insertError) {
    throw new Error(
      `generateDailyList: impossible d'insérer les items — ${insertError.message}`,
    )
  }

  logs.push(log(correlationId, userId, 'generate_items', `${items.length} items insérés dans la daily list`, 'info'))

  // --------------------------------------------------------
  // STEP 9 : Passer la liste en 'ready'
  // --------------------------------------------------------
  const { error: updateStatusError } = await supabaseAdmin
    .from('daily_lists')
    .update({
      status: 'ready',
      generated_at: new Date().toISOString(),
    })
    .eq('id', dailyList.id)

  if (updateStatusError) {
    // Non-fatal : la liste est créée, juste le statut qui n'a pas changé
    logs.push(log(correlationId, userId, 'generate_finalize', `Impossible de passer la liste en 'ready' : ${updateStatusError.message}`, 'warn'))
  }

  const duration_ms = Date.now() - startedAt.getTime()

  logs.push(log(correlationId, userId, 'generate_completed', 'Génération daily list terminée avec succès', 'info', {
    daily_list_id: dailyList.id,
    items_added: items.length,
    items_replaced: itemsReplaced,
    duration_ms,
  }))

  // Log final structuré pour Sentry / Datadog
  console.log(
    JSON.stringify({
      level: 'info',
      module: 'daily-list-generator',
      event: 'daily_list_generated',
      user_id: userId,
      daily_list_id: dailyList.id,
      items_added: items.length,
      items_replaced: itemsReplaced,
      duration_ms,
    }),
  )

  return {
    dailyListId: dailyList.id,
    itemsAdded: items.length,
    itemsReplaced,
    duration_ms,
  }
}
