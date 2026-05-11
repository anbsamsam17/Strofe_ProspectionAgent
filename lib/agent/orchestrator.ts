// ============================================================
// ORCHESTRATOR — Agent IA Prospection Bilan Carbone
// Chef d'orchestre du run nocturne (Vercel Cron 22h)
// ============================================================

import type { Database, Json } from '@/lib/supabase/database.types'
import type { SupabaseAdminClient, SupabaseServerClient } from '@/lib/supabase/server'
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
import { determinerPriorite } from './scoring'
import { genererPitchsBatch } from './pitch-gen'
import { enrichirContact, getCreditsUsed } from './contact-enrichment'
import {
  runPipelineSourcing,
  type AdaptiveSourcingOutcome,
  type PipelineSourcingOutput,
} from './sourcing-runner'

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
  extra: Partial<Database['public']['Tables']['agent_runs']['Update']> = {},
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
    ...extra,
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
  // CRIT-04 : Protection anti-run concurrent.
  // Vérifier qu'aucun run n'est déjà en cours pour cet utilisateur avant d'en créer un nouveau.
  // Deux runs simultanés créent une condition de course sur daily_list_items (DELETE + INSERT concurrent).
  const { data: existingRun } = await supabase
    .from('agent_runs')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'running')
    .maybeSingle()

  if (existingRun) {
    throw new Error(
      `Un run est déjà en cours pour cet utilisateur (run_id: ${existingRun.id})`,
    )
  }

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
// PHASE 3 : SOURCING ADAPTATIF (Wave 2.2 — pagination curseur Sirene)
// ------------------------------------------------------------
//
// Cette phase délègue désormais à `runPipelineSourcing` (lib/agent/sourcing-runner.ts)
// qui fait :
//   1. résolution filtres effectifs + signature
//   2. chargement profiles.sourcing_state + invalidation curseur
//   3. boucle adaptative (fetch page → dedup → continue jusqu'à N candidats)
//   4. enrichissement ADEME (batch 20) + scoring
//   5. upsert prospects (batch 50) + comptage new/updated
//   6. persistance sourcing_state (curseur final, signature, exhausted_at)
//
// L'ancienne phaseScoring est supprimée — l'upsert est fait dans `runPipelineSourcing`.
// Les counters Sirene (total_available, pages_loaded, curseur_final, new/updated) sont
// remontés ici dans `agent_runs` via updateRunInDB.

async function phaseSourcingAdaptive(
  run: AgentRun,
  supabase: SupabaseAdminClient,
  settings: ProfileSettings,
): Promise<{
  output: PipelineSourcingOutput | null
  outcome: AdaptiveSourcingOutcome | null
}> {
  run.phase = 'sourcing_sirene'
  log(run, 'sourcing_sirene', 'Démarrage du sourcing adaptatif (pagination curseur)', 'info')

  // pushLog : pousse à la fois dans le `AgentRun.logs` (in-memory) et console (JSON).
  const pushLog = (
    phase: string,
    message: string,
    level: 'info' | 'warn' | 'error',
    data?: Record<string, unknown>,
  ) => {
    log(run, phase, message, level, data)
  }

  let output: PipelineSourcingOutput
  try {
    output = await runPipelineSourcing({
      userId: run.user_id,
      runId: run.id,
      // L'orchestrator nocturne n'a pas de params UI — il consomme les settings.
      // `target_sectors` est résolu côté `resolveSourcingFilters` (priorité settings.user).
      // Pas de targetRegion / effectifMin/Max → défauts legacy (Gironde, 50+ salariés).
      params: {
        targetSectors: settings.target_sectors,
      },
      settings,
      supabase,
      pushLog,
    })
  } catch (err) {
    throw new Error(
      `phaseSourcingAdaptive: échec pipeline — ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  run.prospects_sourced = output.scored.length
  run.prospects_qualified = output.qualifiedCount

  log(run, 'sourcing_completed', 'Sourcing adaptatif terminé', 'info', {
    prospects_sourced: output.scored.length,
    prospects_qualified: output.qualifiedCount,
    prospects_new: output.prospectsNew,
    prospects_updated: output.prospectsUpdated,
    sirene_total_available: output.outcome.totalAvailable,
    sirene_pages_loaded: output.outcome.pagesLoaded,
    sirene_curseur_final: output.outcome.curseurFinal,
    exhausted: output.outcome.exhausted,
    used_fallback: output.outcome.usedFallback,
  })

  return { output, outcome: output.outcome }
}

// ------------------------------------------------------------
// PHASE 4 : SCORING + UPSERT — délégué à `runPipelineSourcing`
// ------------------------------------------------------------
//
// Depuis Wave 2.2 (fix/sourcing-pagination), l'enrichissement ADEME, le scoring
// et l'upsert prospects sont gérés dans `runPipelineSourcing` (cf. phaseSourcingAdaptive).
// Cette section ne contient plus de logique propre — les compteurs sont déjà
// renseignés dans `run.prospects_sourced` / `run.prospects_qualified` à la sortie
// de la phase 3.

// ------------------------------------------------------------
// PHASE 4.5 : ENRICHISSEMENT CONTACTS (prospects prioritaires)
// ------------------------------------------------------------

/**
 * Enrichit les contacts des prospects avec score > 70 qui n'ont pas encore
 * d'email OU de téléphone, via Pappers + Hunter.io.
 *
 * Contraintes :
 * - Max 10 prospects par run (quota API gratuits)
 * - Appels séquentiels (pas de parallélisme) pour préserver les crédits
 * - Phase NON-FATALE : une erreur ici ne bloque pas le pipeline
 */
async function phaseContactEnrichment(
  run: AgentRun,
  supabase: SupabaseServerClient,
): Promise<void> {
  run.phase = 'contact_enrichment'
  log(run, 'contact_enrichment', 'Démarrage enrichissement contacts (prospects score > 70)', 'info')

  // Charger les prospects avec score > 70 et contact incomplet
  const { data: prospects, error } = await supabase
    .from('prospects')
    .select('id, siren, raison_sociale, contact_email, contact_telephone, contact_nom, contact_prenom, contact_poste, contact_linkedin')
    .eq('user_id', run.user_id)
    .gt('score_priorite', 70)
    .or('contact_email.is.null,contact_telephone.is.null')
    .order('score_priorite', { ascending: false })
    .limit(10)

  if (error) {
    log(run, 'contact_enrichment', 'Impossible de charger les prospects prioritaires', 'warn', {
      error: error.message,
    })
    return
  }

  if (!prospects || prospects.length === 0) {
    log(run, 'contact_enrichment', 'Aucun prospect prioritaire à enrichir (score > 70 avec contact complet ou aucun)', 'info')
    return
  }

  log(run, 'contact_enrichment', `${prospects.length} prospects prioritaires à enrichir`, 'info')

  let enrichis = 0

  // Appels séquentiels — pas de batch parallèle pour préserver les quotas gratuits
  for (const prospect of prospects) {
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
      nouveauxChamps = await enrichirContact(prospect.siren, existingContact, prospect.raison_sociale ?? '')
    } catch (err) {
      log(run, 'contact_enrichment', `Erreur enrichissement SIREN ${prospect.siren}`, 'warn', {
        siren: prospect.siren,
        error: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    // Rien de nouveau trouvé → passer au suivant
    if (Object.keys(nouveauxChamps).length === 0) continue

    // Construire le payload de mise à jour (null explicite pour Supabase)
    const updatePayload: Record<string, string | null> = {}
    for (const [key, value] of Object.entries(nouveauxChamps)) {
      updatePayload[key] = value ?? null
    }

    const { error: updateError } = await supabase
      .from('prospects')
      .update(updatePayload)
      .eq('id', prospect.id)

    if (updateError) {
      log(run, 'contact_enrichment', `Impossible de mettre à jour le contact SIREN ${prospect.siren}`, 'warn', {
        siren: prospect.siren,
        error: updateError.message,
      })
      continue
    }

    enrichis += 1
    log(run, 'contact_enrichment', `Contact enrichi pour SIREN ${prospect.siren}`, 'info', {
      siren: prospect.siren,
      nouveaux_champs: Object.keys(nouveauxChamps),
    })
  }

  const credits = getCreditsUsed()
  log(run, 'contact_enrichment', `Enrichissement terminé`, 'info', {
    prospects_enrichis: enrichis,
    prospects_analyses: prospects.length,
    credits_pappers: credits.pappers,
    credits_hunter: credits.hunter,
  })
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
  // En mode cumulatif, target = nombre de NOUVEAUX prospects à ajouter à chaque run.
  const target = settings.daily_call_target ?? DAILY_CALL_TARGET
  log(run, 'selection', `Sélection de ${target} nouveaux prospects (mode cumulatif)`, 'info')

  // Récupérer les prospect_ids déjà présents dans la daily list du jour
  // pour garantir l'idempotence : relancer 2x ne crée pas de doublons.
  const today = new Date().toISOString().split('T')[0]

  const { data: existingList } = await supabase
    .from('daily_lists')
    .select('id')
    .eq('user_id', run.user_id)
    .eq('date', today)
    .maybeSingle()

  let excludedProspectIds: string[] = []

  if (existingList) {
    const { data: existingListItems } = await supabase
      .from('daily_list_items')
      .select('prospect_id')
      .eq('daily_list_id', existingList.id)

    excludedProspectIds = (existingListItems ?? []).map(
      (row: { prospect_id: string }) => row.prospect_id,
    )
  }

  log(run, 'selection', `${excludedProspectIds.length} prospects déjà dans la liste (exclus)`, 'info')

  // Filtrer uniquement les prospects SANS BEGES valide :
  // - beges_publie = false  → aucun BEGES publié (cible principale)
  // - beges_publie = true ET beges_valide = false → BEGES expiré (> 4 ans)
  // Les prospects avec beges_valide = true sont exclus (conformes, moins prioritaires).
  let query = supabase
    .from('prospects')
    .select('*')
    .eq('user_id', run.user_id)
    .in('statut', ['sourced', 'qualified'])
    .or('beges_publie.eq.false,beges_valide.eq.false')
    .order('score_priorite', { ascending: false })
    .limit(target)

  // Exclure les prospects déjà dans la daily list du jour (anti-doublon)
  if (excludedProspectIds.length > 0) {
    query = query.not('id', 'in', `(${excludedProspectIds.join(',')})`)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(
      `phaseSelection: requête DB échouée — ${error.message}`,
    )
  }

  const prospects = (data ?? []) as unknown as Prospect[]
  log(run, 'selection', `${prospects.length} nouveaux prospects sélectionnés pour la liste du jour`, 'info')

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

  // BUG-FIX : vérifier la cohérence entre pitchs[] et prospects[] avant construction des items.
  // Si un batch GPT a partiellement échoué et retourné moins de pitchs que de prospects,
  // les items excédentaires auront des pitchs vides (les fallbacks du batch gèrent déjà ça,
  // mais on log un warn explicite pour faciliter le debug).
  if (pitchs.length < prospects.length) {
    log(run, 'construction_liste', 'ATTENTION : pitchs.length < prospects.length — certains items auront des pitchs vides', 'warn', {
      pitchs_count: pitchs.length,
      prospects_count: prospects.length,
      manquants: prospects.length - pitchs.length,
    })
  }

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

  // Mode "append cumulatif" : NE PAS supprimer les items existants (ni appelés ni non appelés).
  // Chaque run AJOUTE de nouveaux prospects à la suite de la liste existante.
  // Les items déjà appelés ET non appelés sont tous conservés.
  // Récupérer le dernier ordre de TOUS les items existants pour continuer la numérotation.
  const { data: existingItems } = await supabase
    .from('daily_list_items')
    .select('ordre')
    .eq('daily_list_id', dailyList.id)
    .order('ordre', { ascending: false })
    .limit(1)

  const lastOrdre = existingItems && existingItems.length > 0
    ? (existingItems[0] as { ordre: number }).ordre
    : 0

  // Décaler l'ordre des nouveaux items pour s'ajouter après les items existants.
  const itemsWithOffset = items.map((item) => ({
    ...item,
    ordre: item.ordre + lastOrdre,
  }))

  const { error: itemsError } = await supabase
    .from('daily_list_items')
    .insert(itemsWithOffset as unknown as Database['public']['Tables']['daily_list_items']['Insert'][])

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
  // PHASE 3 + 4 : SOURCING ADAPTATIF + ENRICHISSEMENT + SCORING + UPSERT
  // Wave 2.2 — boucle adaptative avec pagination curseur Sirene, persistance
  // `profiles.sourcing_state`, et remplissage des counters `agent_runs`.
  // --------------------------------------------------------
  let pipelineOutput: PipelineSourcingOutput | null = null
  try {
    const result = await phaseSourcingAdaptive(run, supabaseAdmin, settings)
    pipelineOutput = result.output
    await updateRunInDB(run, supabaseAdmin, {
      prospects_new: pipelineOutput?.prospectsNew ?? null,
      prospects_updated: pipelineOutput?.prospectsUpdated ?? null,
      sirene_total_available: pipelineOutput?.outcome.totalAvailable ?? null,
      sirene_pages_loaded: pipelineOutput?.outcome.pagesLoaded ?? null,
      sirene_curseur_final: pipelineOutput?.outcome.curseurFinal ?? null,
    })
  } catch (err) {
    log(run, 'sourcing_sirene', 'FATAL: sourcing adaptatif échoué', 'error', {
      error: err instanceof Error ? err.message : String(err),
    })
    run.status = 'failed'
    run.error_message = `Sourcing: ${err instanceof Error ? err.message : String(err)}`
    run.completed_at = new Date().toISOString()
    await updateRunInDB(run, supabaseAdmin)
    return run
  }

  // --------------------------------------------------------
  // PHASE 4.5 : ENRICHISSEMENT CONTACTS (prospects prioritaires)
  // Phase NON-FATALE — une erreur ici ne bloque pas le pipeline.
  // Enrichit les contacts des prospects score > 70 sans email/téléphone
  // via Pappers (dirigeants + tel) + Hunter.io (emails).
  // Sans PAPPERS_API_KEY ni HUNTER_API_KEY : phase ignorée silencieusement.
  // --------------------------------------------------------
  try {
    await phaseContactEnrichment(run, supabaseAdmin)
    await updateRunInDB(run, supabaseAdmin)
  } catch (err) {
    log(run, 'contact_enrichment', 'Enrichissement contacts échoué — pipeline non bloqué', 'warn', {
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
