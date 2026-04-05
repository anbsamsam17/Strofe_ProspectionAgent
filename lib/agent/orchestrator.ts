// ============================================================
// ORCHESTRATOR — Agent IA Prospection Bilan Carbone
// Chef d'orchestre du run nocturne (Vercel Cron 22h)
// ============================================================

import type { Database, Json } from '@/lib/supabase/database.types'
import type { SupabaseServerClient } from '@/lib/supabase/server'
import type {
  AgentLog,
  AgentRun,
  DailyList,
  DailyListItem,
  GeneratedPitch,
  Priority,
  ProfileSettings,
  Prospect,
} from '@/lib/types'
import { enrichirProspect, sourcerEntreprises } from './sourcing'
import { calculerScore, determinerPriorite, getScoreDetails } from './scoring'
import { genererPitchsBatch } from './pitch-gen'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

/** Nombre d'appels à préparer dans la liste quotidienne */
const DAILY_CALL_TARGET = 15

/** Score minimum pour qualifier un prospect (l'inclure dans la sélection) */
const SCORE_QUALIFICATION_SEUIL = 20

// ------------------------------------------------------------
// LOGGING STRUCTURÉ
// ------------------------------------------------------------

/**
 * Ajoute une entrée de log dans l'objet AgentRun ET dans la console (JSON).
 * L'objet run est muté en mémoire — la persistance se fait via updateRunInDB.
 */
function log(
  run: AgentRun,
  phase: string,
  message: string,
  level: 'info' | 'warn' | 'error',
  data?: Record<string, unknown>,
): void {
  const entry: AgentLog = {
    timestamp: new Date().toISOString(),
    phase,
    message,
    level,
    data,
  }

  run.logs.push(entry)

  console.log(
    JSON.stringify({
      ...entry,
      run_id: run.id,
      user_id: run.user_id,
    }),
  )
}

// ------------------------------------------------------------
// HELPERS DB
// ------------------------------------------------------------

/**
 * Persiste l'état courant du run en base (status, phase, compteurs, logs).
 * Ne throw pas — en cas d'erreur DB on log et on continue.
 */
async function updateRunInDB(
  run: AgentRun,
  supabase: SupabaseServerClient,
  extra: Partial<AgentRun> = {},
): Promise<void> {
  const updatePayload: Database['public']['Tables']['agent_runs']['Update'] = {
    status: run.status,
    phase: run.phase,
    prospects_sourced: run.prospects_sourced,
    prospects_qualified: run.prospects_qualified,
    list_generated: run.list_generated,
    error_message: run.error_message ?? null,
    logs: run.logs as unknown as Json,
    completed_at: run.completed_at ?? null,
    ...(extra as Partial<Database['public']['Tables']['agent_runs']['Update']>),
  }

  const { error } = await supabase
    .from('agent_runs')
    .update(updatePayload)
    .eq('id', run.id)

  if (error) {
    console.log(
      JSON.stringify({
        level: 'error',
        module: 'orchestrator',
        msg: 'updateRunInDB: échec mise à jour agent_run',
        run_id: run.id,
        error: error.message,
      }),
    )
  }
}

// ------------------------------------------------------------
// PHASE 1 : INIT
// ------------------------------------------------------------

async function phaseInit(
  userId: string,
  supabase: SupabaseServerClient,
): Promise<AgentRun> {
  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      user_id: userId,
      status: 'running',
      phase: 'init',
      prospects_sourced: 0,
      prospects_qualified: 0,
      list_generated: false,
      logs: [],
    })
    .select()
    .single()

  if (error || !data) {
    throw new Error(
      `phaseInit: impossible de créer l'agent_run en DB — ${error?.message ?? 'data null'}`,
    )
  }

  // Mapper la ligne DB vers le type AgentRun
  const run: AgentRun = {
    id: data.id as string,
    user_id: data.user_id as string,
    status: 'running',
    phase: 'init',
    prospects_sourced: 0,
    prospects_qualified: 0,
    list_generated: false,
    logs: [],
    started_at: data.started_at as string,
  }

  log(run, 'init', 'Run nocturne démarré', 'info', { user_id: userId })

  return run
}

// ------------------------------------------------------------
// PHASE 2 : CHARGEMENT SETTINGS
// ------------------------------------------------------------

async function phaseLoadSettings(
  run: AgentRun,
  supabase: SupabaseServerClient,
): Promise<ProfileSettings> {
  run.phase = 'load_settings'
  log(run, 'load_settings', 'Chargement des paramètres utilisateur', 'info')

  const { data, error } = await supabase
    .from('profiles')
    .select('settings')
    .eq('id', run.user_id)
    .single()

  if (error || !data) {
    throw new Error(
      `phaseLoadSettings: profil introuvable pour user ${run.user_id} — ${
        error?.message ?? 'data null'
      }`,
    )
  }

  const settings = data.settings as unknown as ProfileSettings

  log(run, 'load_settings', 'Paramètres chargés', 'info', {
    daily_call_target: settings.daily_call_target,
    target_sectors: settings.target_sectors,
    target_city: settings.target_city,
  })

  return settings
}

// ------------------------------------------------------------
// PHASE 3 : SOURCING
// ------------------------------------------------------------

async function phaseSourcing(
  run: AgentRun,
  supabase: SupabaseServerClient,
): Promise<Array<Partial<Prospect>>> {
  run.phase = 'sourcing_sirene'
  log(run, 'sourcing_sirene', 'Démarrage du sourcing Sirene INSEE', 'info')

  // Récupérer les SIREN déjà en base pour cet utilisateur (déduplication)
  const { data: existingSirens, error: sirenError } = await supabase
    .from('prospects')
    .select('siren')
    .eq('user_id', run.user_id)

  if (sirenError) {
    log(run, 'sourcing_sirene', 'Impossible de charger les SIREN existants — dedup désactivée', 'warn', {
      error: sirenError.message,
    })
  }

  const sirenSet = new Set(
    (existingSirens ?? []).map((row: { siren: string }) => row.siren),
  )

  log(run, 'sourcing_sirene', `${sirenSet.size} SIREN déjà en base (à exclure)`, 'info')

  // Appel API Sirene
  let etablissements: Awaited<ReturnType<typeof sourcerEntreprises>> = []
  try {
    etablissements = await sourcerEntreprises({ maxResults: 200 })
  } catch (err) {
    throw new Error(
      `phaseSourcing: échec Sirene — ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  run.prospects_sourced = etablissements.length
  log(run, 'sourcing_sirene', `${etablissements.length} établissements sourcés depuis Sirene`, 'info')

  // Filtrer les doublons
  const nouveaux = etablissements.filter((e) => !sirenSet.has(e.siren))
  log(run, 'sourcing_sirene', `${nouveaux.length} nouveaux établissements après déduplication`, 'info')

  // Enrichir chaque établissement (appel ADEME par établissement)
  // Parallélisation par batch de 10 pour réduire la durée d'enrichissement :
  // - 200 étabs séquentiels à ~300 ms/appel = ~60 s
  // - 200 étabs en batchs de 10 = ~6-8 s
  // L'API ADEME publique n'impose pas de rate limit documenté — 10 req simultanées
  // est conservateur et compatible avec les quotas observés en pratique.
  run.phase = 'enrichissement'
  log(run, 'enrichissement', 'Enrichissement des prospects (ADEME BEGES)', 'info')

  const ADEME_BATCH_SIZE = 10
  const enrichis: Array<Partial<Prospect>> = []

  for (let i = 0; i < nouveaux.length; i += ADEME_BATCH_SIZE) {
    const batch = nouveaux.slice(i, i + ADEME_BATCH_SIZE)

    const batchResults = await Promise.allSettled(
      batch.map((etab) => enrichirProspect(etab)),
    )

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j]
      const etab = batch[j]

      if (result.status === 'fulfilled') {
        enrichis.push({ ...result.value, user_id: run.user_id })
      } else {
        log(run, 'enrichissement', `Enrichissement échoué pour ${etab.siren}`, 'warn', {
          siren: etab.siren,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
    }
  }

  log(run, 'enrichissement', `${enrichis.length} prospects enrichis`, 'info')

  return enrichis
}

// ------------------------------------------------------------
// PHASE 4 : SCORING + SAUVEGARDE
// ------------------------------------------------------------

async function phaseScoring(
  run: AgentRun,
  supabase: SupabaseServerClient,
  rawProspects: Array<Partial<Prospect>>,
): Promise<Prospect[]> {
  run.phase = 'scoring'
  log(run, 'scoring', `Calcul des scores pour ${rawProspects.length} prospects`, 'info')

  const scored: Array<Partial<Prospect>> = rawProspects.map((p) => {
    const score = calculerScore(p, false) // Nouveaux prospects → jamais contactés
    const details = getScoreDetails(p, false)
    return {
      ...p,
      score_priorite: score,
      score_details: details,
      statut: score >= SCORE_QUALIFICATION_SEUIL ? 'qualified' : 'sourced',
    }
  })

  run.prospects_qualified = scored.filter((p) => p.statut === 'qualified').length
  log(run, 'scoring', `${run.prospects_qualified} prospects qualifiés (score >= ${SCORE_QUALIFICATION_SEUIL})`, 'info')

  // Sauvegarder en DB par batch de 50 (éviter les timeouts sur gros volumes)
  const BATCH_SIZE = 50
  const savedProspects: Prospect[] = []

  for (let i = 0; i < scored.length; i += BATCH_SIZE) {
    const batch = scored.slice(i, i + BATCH_SIZE)

    const { data, error } = await supabase
      .from('prospects')
      .upsert(batch as unknown as Database['public']['Tables']['prospects']['Insert'][], { onConflict: 'user_id,siren' })
      .select()

    if (error) {
      log(run, 'scoring', `Erreur upsert batch ${i / BATCH_SIZE + 1}`, 'warn', {
        error: error.message,
        batch_size: batch.length,
      })
      continue
    }

    if (data) {
      savedProspects.push(...(data as unknown as Prospect[]))
    }
  }

  log(run, 'scoring', `${savedProspects.length} prospects sauvegardés en DB`, 'info')

  return savedProspects
}

// ------------------------------------------------------------
// PHASE 5 : SÉLECTION TOP 15
// ------------------------------------------------------------

async function phaseSelection(
  run: AgentRun,
  supabase: SupabaseServerClient,
  settings: ProfileSettings,
): Promise<Prospect[]> {
  run.phase = 'selection'
  const target = settings.daily_call_target ?? DAILY_CALL_TARGET
  log(run, 'selection', `Sélection des ${target} meilleurs prospects non encore appelés`, 'info')

  const { data, error } = await supabase
    .from('prospects')
    .select('*')
    .eq('user_id', run.user_id)
    .in('statut', ['sourced', 'qualified'])
    .order('score_priorite', { ascending: false })
    .limit(target)

  if (error) {
    throw new Error(
      `phaseSelection: requête DB échouée — ${error.message}`,
    )
  }

  const prospects = (data ?? []) as unknown as Prospect[]
  log(run, 'selection', `${prospects.length} prospects sélectionnés pour la liste du jour`, 'info')

  return prospects
}

// ------------------------------------------------------------
// PHASE 6 : GÉNÉRATION PITCHS
// ------------------------------------------------------------

async function phaseGeneratePitchs(
  run: AgentRun,
  prospects: Prospect[],
  settings: ProfileSettings,
): Promise<GeneratedPitch[]> {
  run.phase = 'generation_pitch'
  log(run, 'generation_pitch', `Génération de ${prospects.length} pitchs via GPT-4o`, 'info')

  const pitchs = await genererPitchsBatch(prospects, settings)

  log(run, 'generation_pitch', `${pitchs.length} pitchs générés`, 'info')

  return pitchs
}

// ------------------------------------------------------------
// PHASE 7 : CRÉATION DAILY LIST
// ------------------------------------------------------------

async function phaseCreateDailyList(
  run: AgentRun,
  supabase: SupabaseServerClient,
  prospects: Prospect[],
  pitchs: GeneratedPitch[],
): Promise<DailyList> {
  run.phase = 'construction_liste'

  const today = new Date().toISOString().split('T')[0] // "YYYY-MM-DD"
  log(run, 'construction_liste', `Création de la daily_list pour le ${today}`, 'info')

  // Créer ou récupérer la liste du jour (upsert pour idempotence)
  const { data: listData, error: listError } = await supabase
    .from('daily_lists')
    .upsert(
      {
        user_id: run.user_id,
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
      `phaseCreateDailyList: impossible de créer daily_list — ${listError?.message ?? 'data null'}`,
    )
  }

  const dailyList = listData as DailyList

  // Construire les items (type Record pour l'insert Supabase — null vs undefined)
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

  const items: DailyListInsert[] = prospects.map((prospect, index) => {
    const pitch = pitchs[index]
    const priority: Priority = determinerPriorite(prospect.score_priorite)

    return {
      daily_list_id: dailyList.id,
      user_id: run.user_id,
      prospect_id: prospect.id,
      ordre: index + 1,
      priorite: priority,
      meilleur_creneau: pitch?.meilleur_creneau ?? '10h-11h',
      accroche: pitch?.accroche ?? '',
      pitch: pitch?.pitch ?? '',
      signaux_detectes: prospect.signaux ?? [],
      objections_reponses: pitch?.objections ?? [],
      contact_type: pitch?.contact_type ?? 'rse',
      // null explicite pour compatibilité Supabase (undefined est ignoré par JSON.stringify)
      call_result: null,
      callback_date: null,
      call_notes: null,
      called_at: null,
    }
  })

  // Insérer les items (suppression préalable pour idempotence)
  await supabase
    .from('daily_list_items')
    .delete()
    .eq('daily_list_id', dailyList.id)

  const { error: itemsError } = await supabase
    .from('daily_list_items')
    .insert(items as unknown as Database['public']['Tables']['daily_list_items']['Insert'][])

  if (itemsError) {
    throw new Error(
      `phaseCreateDailyList: impossible d'insérer les items — ${itemsError.message}`,
    )
  }

  // Passer la liste en status 'ready'
  const { error: updateError } = await supabase
    .from('daily_lists')
    .update({
      status: 'ready',
      generated_at: new Date().toISOString(),
    })
    .eq('id', dailyList.id)

  if (updateError) {
    log(run, 'construction_liste', 'Impossible de passer la liste en status ready', 'warn', {
      error: updateError.message,
    })
  }

  run.list_generated = true
  log(run, 'construction_liste', `Daily list créée avec ${items.length} items`, 'info', {
    daily_list_id: dailyList.id,
    date: today,
  })

  return { ...dailyList, status: 'ready' }
}

// ------------------------------------------------------------
// ORCHESTRATEUR PRINCIPAL
// ------------------------------------------------------------

/**
 * Point d'entrée du run nocturne de l'agent.
 * Coordonne toutes les phases dans l'ordre, avec gestion d'erreur par phase.
 *
 * @param userId - ID Supabase Auth de l'utilisateur (UUID)
 * @param supabaseAdmin - Client Supabase avec service_role (bypasse RLS)
 */
export async function runAgentNocturne(
  userId: string,
  supabaseAdmin: SupabaseServerClient,
): Promise<AgentRun> {
  // --------------------------------------------------------
  // PHASE 1 : INIT — créer le run en DB
  // --------------------------------------------------------
  let run: AgentRun

  try {
    run = await phaseInit(userId, supabaseAdmin)
  } catch (err) {
    // Si l'init échoue, on ne peut pas logger en DB — log console uniquement
    console.log(
      JSON.stringify({
        level: 'error',
        module: 'orchestrator',
        msg: 'phaseInit FATAL — impossible de créer l\'agent_run',
        user_id: userId,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    throw err
  }

  // --------------------------------------------------------
  // PHASE 2 : CHARGEMENT SETTINGS
  // --------------------------------------------------------
  let settings: ProfileSettings
  try {
    settings = await phaseLoadSettings(run, supabaseAdmin)
    await updateRunInDB(run, supabaseAdmin)
  } catch (err) {
    log(run, 'load_settings', 'FATAL: impossible de charger les settings', 'error', {
      error: err instanceof Error ? err.message : String(err),
    })
    run.status = 'failed'
    run.error_message = `Chargement settings: ${err instanceof Error ? err.message : String(err)}`
    run.completed_at = new Date().toISOString()
    await updateRunInDB(run, supabaseAdmin)
    return run
  }

  // --------------------------------------------------------
  // PHASE 3 : SOURCING + ENRICHISSEMENT
  // --------------------------------------------------------
  let rawProspects: Array<Partial<Prospect>> = []
  try {
    rawProspects = await phaseSourcing(run, supabaseAdmin)
    await updateRunInDB(run, supabaseAdmin)
  } catch (err) {
    log(run, 'sourcing_sirene', 'FATAL: sourcing Sirene échoué', 'error', {
      error: err instanceof Error ? err.message : String(err),
    })
    run.status = 'failed'
    run.error_message = `Sourcing: ${err instanceof Error ? err.message : String(err)}`
    run.completed_at = new Date().toISOString()
    await updateRunInDB(run, supabaseAdmin)
    return run
  }

  // --------------------------------------------------------
  // PHASE 4 : SCORING + SAUVEGARDE
  // savedProspects retourné pour le log de comptage (non utilisé en aval
  // car phaseSelection refait une requête DB triée pour garantir l'ordre).
  // --------------------------------------------------------
  try {
    await phaseScoring(run, supabaseAdmin, rawProspects)
    await updateRunInDB(run, supabaseAdmin)
  } catch (err) {
    // Non-fatal : on peut continuer avec les prospects déjà en DB
    log(run, 'scoring', 'Scoring partiellement échoué — utilisation des prospects existants', 'warn', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // --------------------------------------------------------
  // PHASE 5 : SÉLECTION TOP 15
  // --------------------------------------------------------
  let selectedProspects: Prospect[] = []
  try {
    selectedProspects = await phaseSelection(run, supabaseAdmin, settings)
    await updateRunInDB(run, supabaseAdmin)
  } catch (err) {
    log(run, 'selection', 'FATAL: sélection échouée', 'error', {
      error: err instanceof Error ? err.message : String(err),
    })
    run.status = 'failed'
    run.error_message = `Sélection: ${err instanceof Error ? err.message : String(err)}`
    run.completed_at = new Date().toISOString()
    await updateRunInDB(run, supabaseAdmin)
    return run
  }

  if (selectedProspects.length === 0) {
    log(run, 'selection', 'Aucun prospect disponible pour la liste du jour', 'warn')
    run.status = 'completed'
    run.list_generated = false
    run.completed_at = new Date().toISOString()
    await updateRunInDB(run, supabaseAdmin)
    return run
  }

  // --------------------------------------------------------
  // PHASE 6 : GÉNÉRATION PITCHS
  // --------------------------------------------------------
  let pitchs: GeneratedPitch[] = []
  try {
    pitchs = await phaseGeneratePitchs(run, selectedProspects, settings)
    await updateRunInDB(run, supabaseAdmin)
  } catch (err) {
    // Non-fatal : le batch gère les erreurs individuelles et retourne des pitchs fallback
    log(run, 'generation_pitch', 'Génération pitchs partiellement échouée', 'warn', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // --------------------------------------------------------
  // PHASE 7 : CRÉATION DAILY LIST
  // --------------------------------------------------------
  try {
    await phaseCreateDailyList(run, supabaseAdmin, selectedProspects, pitchs)
    await updateRunInDB(run, supabaseAdmin)
  } catch (err) {
    log(run, 'construction_liste', 'FATAL: création daily list échouée', 'error', {
      error: err instanceof Error ? err.message : String(err),
    })
    run.status = 'failed'
    run.error_message = `Daily list: ${err instanceof Error ? err.message : String(err)}`
    run.completed_at = new Date().toISOString()
    await updateRunInDB(run, supabaseAdmin)
    return run
  }

  // --------------------------------------------------------
  // PHASE 8 : FINALISATION
  // --------------------------------------------------------
  run.phase = 'completed'
  run.status = 'completed'
  run.completed_at = new Date().toISOString()

  log(run, 'completed', 'Run nocturne terminé avec succès', 'info', {
    prospects_sourced: run.prospects_sourced,
    prospects_qualified: run.prospects_qualified,
    list_generated: run.list_generated,
    duration_ms:
      new Date(run.completed_at).getTime() - new Date(run.started_at).getTime(),
  })

  await updateRunInDB(run, supabaseAdmin)

  return run
}
