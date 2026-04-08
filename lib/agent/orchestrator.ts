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
import { enrichirProspect, sourcerEntreprises, sourcerEntreprisesFallback } from './sourcing'
import { calculerScore, determinerPriorite, getScoreDetails } from './scoring'
import { genererPitchsBatch } from './pitch-gen'
import { enrichirContact, getCreditsUsed } from './contact-enrichment'

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
// PHASE 3 : SOURCING
// ------------------------------------------------------------

// NAF_PRIORITAIRES par défaut utilisés quand les settings ne fournissent pas de codes NAF valides.
// Format avec point (les deux APIs — Sirene et fallback — acceptent ce format ici,
// sourcing.ts normalise le format en interne selon l'API cible).
const NAF_PRIORITAIRES_DEFAULT = [
  '01.21Z', '01.22Z',        // Viticulture
  '30.30Z',                  // Construction aéronautique
  '52.10B', '52.29A',        // Logistique / entreposage
  '10.11Z', '10.13A', '10.32Z', '10.51A', '10.71A', // Agro-alimentaire
  '46.17B',                  // Commerce intermédiaire agro
  '49.41A', '49.41B', '52.21Z', // Transport routier / services annexes
  // Secteurs élargis — pertinents pour le bilan carbone
  '20.11Z', '20.14Z', '20.15Z', // Industrie chimique
  '23.11Z', '23.13Z',        // Verre et produits en verre
  '24.10Z', '24.20Z',        // Sidérurgie / tubes acier
  '25.11Z', '25.29Z',        // Fabrication structures métalliques
  '28.11Z', '28.15Z',        // Fabrication moteurs / engrenages
  '35.11Z', '35.14Z',        // Production / commerce d'électricité
  '38.11Z', '38.21Z',        // Collecte / traitement des déchets
  '41.20A', '41.20B',        // Construction de bâtiments
  '42.11Z', '42.13A',        // Construction routes / ponts
  '43.21A', '43.22A',        // Travaux d'installation
  '46.71Z', '46.72Z',        // Commerce gros combustibles / métaux
  '47.30Z',                  // Commerce carburants
  '55.10Z',                  // Hôtels
  '56.10A',                  // Restauration
  '86.10Z',                  // Activités hospitalières
]

async function phaseSourcing(
  run: AgentRun,
  supabase: SupabaseServerClient,
  settings: ProfileSettings,
): Promise<Array<Partial<Prospect>>> {
  run.phase = 'sourcing_sirene'
  log(run, 'sourcing_sirene', 'Démarrage du sourcing Sirene INSEE', 'info')

  // IMP-08 : Construction des options de sourcing depuis les settings utilisateur.
  // - Si settings.target_sectors est non vide, l'utiliser comme nafCodes.
  //   Note : les settings stockent les secteurs sous forme de codes NAF (ex: "49.41A")
  //   ou de noms libres. On valide le format NAF (NNNNX) — si invalide, fallback NAF_PRIORITAIRES.
  // - Si settings.target_city est défini, l'utiliser pour affiner le filtre géographique.
  //   Pour l'instant, on utilise le code postal range par défaut (Gironde) — la v2 mapera
  //   target_city → code département pour la plage codePostalRange.
  const targetSectors = settings.target_sectors ?? []
  const nafRegex = /^\d{2}\.\d{2}[A-Z]$/
  const validNafCodes = targetSectors.filter((s) => nafRegex.test(s.trim().toUpperCase()))
  const nafCodes = validNafCodes.length > 0 ? validNafCodes : NAF_PRIORITAIRES_DEFAULT

  log(run, 'sourcing_sirene', `Codes NAF utilisés pour le sourcing`, 'info', {
    source: validNafCodes.length > 0 ? 'settings_user' : 'naf_prioritaires_default',
    count: nafCodes.length,
  })

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

  // Appel API Sirene INSEE (primaire) avec fallback Recherche Entreprises (open data)
  let etablissements: Awaited<ReturnType<typeof sourcerEntreprises>> = []
  try {
    etablissements = await sourcerEntreprises({ maxResults: 200, nafCodes })
  } catch (err) {
    log(run, 'sourcing_sirene', `API Sirene INSEE erreur — bascule sur fallback`, 'warn', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Fallback si Sirene a retourné 0 résultats (auth 401, rate limit, ou API down)
  if (etablissements.length === 0) {
    log(run, 'sourcing_sirene', 'Sirene: 0 résultats — bascule sur Recherche Entreprises (open data)', 'warn')
    try {
      // Passer excludeSirens pour déduplication en amont : le fallback pagine à travers
      // toutes les pages et skip les SIREN déjà connus, évitant le gaspillage de quota.
      etablissements = await sourcerEntreprisesFallback({
        maxResults: 200,
        nafCodes,
        excludeSirens: sirenSet,
      })
      log(run, 'sourcing_sirene', `Fallback Recherche Entreprises: ${etablissements.length} établissements sourcés`, 'info')
    } catch (fallbackErr) {
      throw new Error(
        `phaseSourcing: échec Sirene ET fallback — ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
      )
    }
  }

  run.prospects_sourced = etablissements.length
  log(run, 'sourcing_sirene', `${etablissements.length} établissements sourcés depuis Sirene`, 'info')

  // Filtrer les doublons (pour les résultats Sirene primaire — le fallback a déjà dédupliqué)
  const nouveaux = etablissements.filter((e) => !sirenSet.has(e.siren))
  log(run, 'sourcing_sirene', `${nouveaux.length} nouveaux établissements après déduplication`, 'info')

  // Warnings sur le volume de nouveaux prospects
  if (nouveaux.length === 0) {
    log(run, 'sourcing_sirene', 'ATTENTION : tous les prospects sont déjà en base — élargir les critères ou le périmètre géographique', 'warn')
  } else if (nouveaux.length < (settings.daily_call_target ?? 15)) {
    log(run, 'sourcing_sirene', `Seulement ${nouveaux.length} nouveaux prospects trouvés (objectif: ${settings.daily_call_target ?? 15})`, 'warn')
  }

  // Enrichir chaque établissement (appel ADEME par établissement)
  // Parallélisation par batch de 20 (augmenté depuis 10 — perf audit recommandation #3) :
  // - 200 étabs séquentiels à ~300 ms/appel = ~60 s
  // - 200 étabs en batchs de 20 = ~3-4 s
  // L'API ADEME Data Fair publique n'impose pas de rate limit documenté.
  run.phase = 'enrichissement'
  log(run, 'enrichissement', 'Enrichissement des prospects (ADEME BEGES)', 'info')

  const ADEME_BATCH_SIZE = 20
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

    // Tentative d'upsert. Si les colonnes beges_url/beges_valide n'existent pas encore
    // en DB (migration 004 non appliquée), on retry sans ces colonnes.
    let data: unknown[] | null = null
    let error: { message: string } | null = null

    const result1 = await supabase
      .from('prospects')
      .upsert(batch as unknown as Database['public']['Tables']['prospects']['Insert'][], { onConflict: 'user_id,siren' })
      .select()

    if (result1.error && result1.error.message.includes('beges_')) {
      // Fallback : retirer les colonnes BEGES non migrées
      const cleanBatch = batch.map(({ beges_url, beges_valide, ...rest }) => rest)
      const result2 = await supabase
        .from('prospects')
        .upsert(cleanBatch as unknown as Database['public']['Tables']['prospects']['Insert'][], { onConflict: 'user_id,siren' })
        .select()
      data = result2.data
      error = result2.error
      if (!error) {
        log(run, 'scoring', 'Migration 004 non appliquée — colonnes beges_url/beges_valide ignorées', 'warn')
      }
    } else {
      data = result1.data
      error = result1.error
    }

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
    .select('id, siren, contact_email, contact_telephone, contact_nom, contact_prenom, contact_poste, contact_linkedin')
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
      nouveauxChamps = await enrichirContact(prospect.siren, existingContact)
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
  // PHASE 3 : SOURCING + ENRICHISSEMENT
  // --------------------------------------------------------
  let rawProspects: Array<Partial<Prospect>> = []
  try {
    rawProspects = await phaseSourcing(run, supabaseAdmin, settings)
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
