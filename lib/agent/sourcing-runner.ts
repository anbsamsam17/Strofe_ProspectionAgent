// ============================================================
// SOURCING RUNNER — Agent IA Prospection Bilan Carbone
// Orchestrateur de sourcing pur : cherche de nouvelles entreprises
// et les ajoute dans la table `prospects`.
//
// NE TOUCHE PAS à la daily list.
// NE FAIT PAS d'enrichissement contacts (Pappers/Hunter).
// NE GÉNÈRE PAS de pitchs.
// ============================================================

import type { Database, Json } from '@/lib/supabase/database.types'
import type { SupabaseAdminClient } from '@/lib/supabase/server'
import type { AgentLog, AgentRun, ProfileSettings, Prospect } from '@/lib/types'
import { enrichirProspect, sourcerEntreprises, sourcerEntreprisesFallback } from './sourcing'
import { calculerScore, getScoreDetails } from './scoring'

// ------------------------------------------------------------
// TYPES PUBLICS
// ------------------------------------------------------------

export interface SourcingParams {
  /** Effectif maximum ciblé (ex: 500 → tranches d'effectif ≤ correspondante) */
  effectifMax?: number
  /** Effectif minimum ciblé (ex: 50 → tranches d'effectif ≥ correspondante) */
  effectifMin?: number
  /**
   * Codes NAF à cibler (format NNNNX avec point — ex: "49.41A").
   * Si vide ou absent, utilise les codes NAF_PRIORITAIRES_DEFAULT de l'orchestrateur.
   */
  targetSectors?: string[]
  /**
   * Code département (ex: "33" pour la Gironde) ou range de codes postaux
   * au format "[33000 TO 33999]" compatible Lucene.
   */
  targetRegion?: string
}

export interface SourcingResult {
  runId: string
  prospectsNew: number
  prospectsUpdated: number
  duration_ms: number
}

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

const SCORE_QUALIFICATION_SEUIL = 20
const ADEME_BATCH_SIZE = 20

const NAF_PRIORITAIRES_DEFAULT = [
  '01.21Z', '01.22Z',
  '30.30Z',
  '52.10B', '52.29A',
  '10.11Z', '10.13A', '10.32Z', '10.51A', '10.71A',
  '46.17B',
  '49.41A', '49.41B', '52.21Z',
  '20.11Z', '20.14Z', '20.15Z',
  '23.11Z', '23.13Z',
  '24.10Z', '24.20Z',
  '25.11Z', '25.29Z',
  '28.11Z', '28.15Z',
  '35.11Z', '35.14Z',
  '38.11Z', '38.21Z',
  '41.20A', '41.20B',
  '42.11Z', '42.13A',
  '43.21A', '43.22A',
  '46.71Z', '46.72Z',
  '47.30Z',
  '55.10Z',
  '56.10A',
  '86.10Z',
]

// ------------------------------------------------------------
// LOGGING STRUCTURÉ (JSON)
// ------------------------------------------------------------

function log(
  runId: string,
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
      run_id: runId,
      user_id: userId,
    }),
  )

  return entry
}

// ------------------------------------------------------------
// HELPERS DB
// ------------------------------------------------------------

async function updateRunInDB(
  runId: string,
  supabase: SupabaseAdminClient,
  payload: Partial<{
    status: AgentRun['status']
    phase: string
    prospects_sourced: number
    prospects_qualified: number
    error_message: string | null
    logs: AgentLog[]
    completed_at: string | null
  }>,
): Promise<void> {
  const updatePayload: Database['public']['Tables']['agent_runs']['Update'] = {
    ...(payload.status !== undefined && { status: payload.status }),
    ...(payload.phase !== undefined && { phase: payload.phase }),
    ...(payload.prospects_sourced !== undefined && { prospects_sourced: payload.prospects_sourced }),
    ...(payload.prospects_qualified !== undefined && { prospects_qualified: payload.prospects_qualified }),
    ...(payload.error_message !== undefined && { error_message: payload.error_message }),
    ...(payload.logs !== undefined && { logs: payload.logs as unknown as Json }),
    ...(payload.completed_at !== undefined && { completed_at: payload.completed_at }),
  }

  const { error } = await supabase
    .from('agent_runs')
    .update(updatePayload)
    .eq('id', runId)

  if (error) {
    console.log(
      JSON.stringify({
        level: 'error',
        module: 'sourcing-runner',
        msg: 'updateRunInDB: échec mise à jour agent_run',
        run_id: runId,
        error: error.message,
      }),
    )
  }
}

// ------------------------------------------------------------
// ORCHESTRATEUR DE SOURCING PUR
// ------------------------------------------------------------

/**
 * Lance un run de sourcing pur :
 *   1. Crée un agent_run avec phase = 'sourcing'
 *   2. Récupère les SIREN déjà en base (déduplication)
 *   3. Appelle sourcerEntreprises() (INSEE) puis sourcerEntreprisesFallback()
 *   4. Enrichit chaque prospect via ADEME BEGES
 *   5. Calcule le score de chaque prospect
 *   6. Upsert dans la table `prospects`
 *   7. Met à jour le run en DB
 *   8. Retourne le résultat
 *
 * @param userId       - ID Supabase Auth de l'utilisateur (UUID)
 * @param supabaseAdmin - Client Supabase service_role (bypass RLS)
 * @param params       - Paramètres de ciblage (secteurs, région, effectif)
 */
export async function runSourcing(
  userId: string,
  supabaseAdmin: SupabaseAdminClient,
  params: SourcingParams = {},
): Promise<SourcingResult> {
  const startedAt = new Date()
  const logs: AgentLog[] = []

  // --------------------------------------------------------
  // INIT : créer le run en DB
  // --------------------------------------------------------
  const { data: runData, error: runError } = await supabaseAdmin
    .from('agent_runs')
    .insert({
      user_id: userId,
      status: 'running',
      phase: 'sourcing',
      prospects_sourced: 0,
      prospects_qualified: 0,
      list_generated: false,
      logs: [],
    })
    .select()
    .single()

  if (runError || !runData) {
    throw new Error(
      `runSourcing: impossible de créer l'agent_run — ${runError?.message ?? 'data null'}`,
    )
  }

  const runId: string = runData.id as string
  logs.push(log(runId, userId, 'sourcing_init', 'Run sourcing démarré', 'info', { params }))

  // --------------------------------------------------------
  // PHASE : CHARGEMENT SETTINGS (pour les codes NAF par défaut)
  // --------------------------------------------------------
  let settings: ProfileSettings | null = null
  try {
    const { data: profileData } = await supabaseAdmin
      .from('profiles')
      .select('settings')
      .eq('id', userId)
      .single()

    settings = profileData?.settings as unknown as ProfileSettings ?? null
  } catch {
    logs.push(log(runId, userId, 'sourcing_init', 'Settings introuvables — paramètres par défaut utilisés', 'warn'))
  }

  // --------------------------------------------------------
  // PHASE : CALCUL DES OPTIONS NAF
  // --------------------------------------------------------
  const nafRegex = /^\d{2}\.\d{2}[A-Z]$/

  // Priorité : params.targetSectors > settings.target_sectors > NAF_PRIORITAIRES_DEFAULT
  let nafCodes: string[]
  if (params.targetSectors && params.targetSectors.length > 0) {
    const valid = params.targetSectors.filter((s) => nafRegex.test(s.trim().toUpperCase()))
    nafCodes = valid.length > 0 ? valid : NAF_PRIORITAIRES_DEFAULT
    logs.push(log(runId, userId, 'sourcing', `Codes NAF depuis params request (${nafCodes.length})`, 'info', {
      source: 'params_request',
    }))
  } else if (settings?.target_sectors && settings.target_sectors.length > 0) {
    const valid = settings.target_sectors.filter((s) => nafRegex.test(s.trim().toUpperCase()))
    nafCodes = valid.length > 0 ? valid : NAF_PRIORITAIRES_DEFAULT
    logs.push(log(runId, userId, 'sourcing', `Codes NAF depuis settings user (${nafCodes.length})`, 'info', {
      source: 'settings_user',
    }))
  } else {
    nafCodes = NAF_PRIORITAIRES_DEFAULT
    logs.push(log(runId, userId, 'sourcing', `Codes NAF par défaut (${nafCodes.length})`, 'info', {
      source: 'naf_prioritaires_default',
    }))
  }

  // --------------------------------------------------------
  // PHASE : DÉDUPLICATION — récupérer les SIREN existants
  // --------------------------------------------------------
  const { data: existingSirens, error: sirenError } = await supabaseAdmin
    .from('prospects')
    .select('siren')
    .eq('user_id', userId)

  if (sirenError) {
    logs.push(log(runId, userId, 'sourcing', 'Impossible de charger les SIREN existants — dédup désactivée', 'warn', {
      error: sirenError.message,
    }))
  }

  const sirenSet = new Set(
    (existingSirens ?? []).map((row: { siren: string }) => row.siren),
  )
  logs.push(log(runId, userId, 'sourcing', `${sirenSet.size} SIREN déjà en base (à exclure)`, 'info'))

  await updateRunInDB(runId, supabaseAdmin, {
    phase: 'sourcing_sirene',
    logs,
  })

  // --------------------------------------------------------
  // PHASE : SOURCING INSEE + FALLBACK
  // --------------------------------------------------------
  let etablissements: Awaited<ReturnType<typeof sourcerEntreprises>> = []

  try {
    etablissements = await sourcerEntreprises({ maxResults: 200, nafCodes })
    logs.push(log(runId, userId, 'sourcing_sirene', `Sirene INSEE: ${etablissements.length} établissements sourcés`, 'info'))
  } catch (err) {
    logs.push(log(runId, userId, 'sourcing_sirene', 'API Sirene INSEE erreur — bascule sur fallback', 'warn', {
      error: err instanceof Error ? err.message : String(err),
    }))
  }

  if (etablissements.length === 0) {
    logs.push(log(runId, userId, 'sourcing_sirene', 'Sirene: 0 résultats — bascule sur Recherche Entreprises (open data)', 'warn'))
    try {
      etablissements = await sourcerEntreprisesFallback({
        maxResults: 200,
        nafCodes,
        excludeSirens: sirenSet,
      })
      logs.push(log(runId, userId, 'sourcing_sirene', `Fallback Recherche Entreprises: ${etablissements.length} établissements sourcés`, 'info'))
    } catch (fallbackErr) {
      const errMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
      logs.push(log(runId, userId, 'sourcing_sirene', 'FATAL: sourcing Sirene ET fallback échoués', 'error', {
        error: errMsg,
      }))
      await updateRunInDB(runId, supabaseAdmin, {
        status: 'failed',
        phase: 'sourcing_sirene',
        error_message: `Sourcing: ${errMsg}`,
        logs,
        completed_at: new Date().toISOString(),
      })
      throw new Error(`runSourcing: échec total sourcing — ${errMsg}`)
    }
  }

  // Filtrer les nouveaux (déduplication pour Sirene primaire — fallback a déjà dédupliqué)
  const nouveaux = etablissements.filter((e) => !sirenSet.has(e.siren))
  logs.push(log(runId, userId, 'sourcing', `${nouveaux.length} nouveaux établissements après déduplication`, 'info'))

  if (nouveaux.length === 0) {
    logs.push(log(runId, userId, 'sourcing', 'ATTENTION : tous les prospects sont déjà en base — élargir les critères', 'warn'))
    await updateRunInDB(runId, supabaseAdmin, {
      status: 'completed',
      phase: 'sourcing',
      prospects_sourced: 0,
      prospects_qualified: 0,
      logs,
      completed_at: new Date().toISOString(),
    })
    return {
      runId,
      prospectsNew: 0,
      prospectsUpdated: 0,
      duration_ms: Date.now() - startedAt.getTime(),
    }
  }

  await updateRunInDB(runId, supabaseAdmin, {
    phase: 'enrichissement',
    prospects_sourced: nouveaux.length,
    logs,
  })

  // --------------------------------------------------------
  // PHASE : ENRICHISSEMENT ADEME BEGES (par batch de 20)
  // --------------------------------------------------------
  logs.push(log(runId, userId, 'enrichissement', `Enrichissement ADEME BEGES pour ${nouveaux.length} prospects`, 'info'))

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
        enrichis.push({ ...result.value, user_id: userId })
      } else {
        logs.push(log(runId, userId, 'enrichissement', `Enrichissement échoué pour ${etab.siren}`, 'warn', {
          siren: etab.siren,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }))
        // Mode dégradé : inclure le prospect sans données ADEME
        enrichis.push({ ...etab, user_id: userId })
      }
    }
  }

  logs.push(log(runId, userId, 'enrichissement', `${enrichis.length} prospects enrichis`, 'info'))

  // --------------------------------------------------------
  // PHASE : SCORING
  // --------------------------------------------------------
  await updateRunInDB(runId, supabaseAdmin, {
    phase: 'scoring',
    logs,
  })

  const scored: Array<Partial<Prospect>> = enrichis.map((p) => {
    const score = calculerScore(p, false)
    const details = getScoreDetails(p, false)
    return {
      ...p,
      score_priorite: score,
      score_details: details,
      statut: score >= SCORE_QUALIFICATION_SEUIL ? 'qualified' : 'sourced',
    }
  })

  const qualifiedCount = scored.filter((p) => p.statut === 'qualified').length
  logs.push(log(runId, userId, 'scoring', `${qualifiedCount} prospects qualifiés (score >= ${SCORE_QUALIFICATION_SEUIL})`, 'info'))

  // --------------------------------------------------------
  // PHASE : UPSERT EN BASE (batch de 50)
  // --------------------------------------------------------
  await updateRunInDB(runId, supabaseAdmin, {
    phase: 'upsert',
    prospects_sourced: enrichis.length,
    prospects_qualified: qualifiedCount,
    logs,
  })

  const UPSERT_BATCH_SIZE = 50
  let prospectsNew = 0
  let prospectsUpdated = 0

  for (let i = 0; i < scored.length; i += UPSERT_BATCH_SIZE) {
    const batch = scored.slice(i, i + UPSERT_BATCH_SIZE)

    // Tentative d'upsert avec colonnes BEGES — fallback sans ces colonnes si migration non appliquée
    let upsertError: { message: string } | null = null

    const result1 = await supabaseAdmin
      .from('prospects')
      .upsert(batch as unknown as Database['public']['Tables']['prospects']['Insert'][], {
        onConflict: 'user_id,siren',
      })
      .select('id,created_at,updated_at')

    if (result1.error && result1.error.message.includes('beges_')) {
      const cleanBatch = batch.map(({ beges_url, beges_valide, ...rest }) => rest)
      const result2 = await supabaseAdmin
        .from('prospects')
        .upsert(cleanBatch as unknown as Database['public']['Tables']['prospects']['Insert'][], {
          onConflict: 'user_id,siren',
        })
        .select('id,created_at,updated_at')
      upsertError = result2.error

      if (!result2.error) {
        logs.push(log(runId, userId, 'upsert', 'Migration 004 non appliquée — colonnes beges_url/beges_valide ignorées', 'warn'))
        // Compter approximativement (heuristique : ligne créée si created_at == updated_at à la seconde)
        const rows = result2.data ?? []
        for (const row of rows) {
          const r = row as { created_at: string; updated_at: string }
          if (r.created_at === r.updated_at) prospectsNew++
          else prospectsUpdated++
        }
      }
    } else {
      upsertError = result1.error
      const rows = result1.data ?? []
      for (const row of rows) {
        const r = row as { created_at: string; updated_at: string }
        if (r.created_at === r.updated_at) prospectsNew++
        else prospectsUpdated++
      }
    }

    if (upsertError) {
      logs.push(log(runId, userId, 'upsert', `Erreur upsert batch ${i / UPSERT_BATCH_SIZE + 1}`, 'warn', {
        error: upsertError.message,
        batch_size: batch.length,
      }))
    }
  }

  logs.push(log(runId, userId, 'upsert', `Upsert terminé : ${prospectsNew} nouveaux, ${prospectsUpdated} mis à jour`, 'info', {
    prospects_new: prospectsNew,
    prospects_updated: prospectsUpdated,
  }))

  // --------------------------------------------------------
  // FINALISATION
  // --------------------------------------------------------
  const completedAt = new Date()
  const duration_ms = completedAt.getTime() - startedAt.getTime()

  logs.push(log(runId, userId, 'sourcing_completed', 'Run sourcing terminé avec succès', 'info', {
    prospects_new: prospectsNew,
    prospects_updated: prospectsUpdated,
    duration_ms,
  }))

  await updateRunInDB(runId, supabaseAdmin, {
    status: 'completed',
    phase: 'sourcing_completed',
    prospects_sourced: enrichis.length,
    prospects_qualified: qualifiedCount,
    logs,
    completed_at: completedAt.toISOString(),
  })

  return {
    runId,
    prospectsNew,
    prospectsUpdated,
    duration_ms,
  }
}
