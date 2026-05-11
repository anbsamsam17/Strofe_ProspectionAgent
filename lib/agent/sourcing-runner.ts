// ============================================================
// SOURCING RUNNER — Agent IA Prospection Bilan Carbone
// Orchestrateur de sourcing pur : cherche de nouvelles entreprises
// et les ajoute dans la table `prospects`.
//
// Wave 2.2 (fix/sourcing-pagination) — boucle adaptative :
//   - pagination par curseur Sirene (persistance entre runs via profiles.sourcing_state)
//   - stop quand N candidats atteint ou curseur épuisé
//   - signature de filtres (invalidation curseur si filtres changent)
//   - logging structuré par page + counters dans agent_runs
//
// NE TOUCHE PAS à la daily list.
// NE FAIT PAS d'enrichissement contacts (Pappers/Hunter).
// NE GÉNÈRE PAS de pitchs.
// ============================================================

import type { Database, Json } from '@/lib/supabase/database.types'
import type { SupabaseAdminClient } from '@/lib/supabase/server'
import type { AgentLog, AgentRun, ProfileSettings, Prospect, SireneEtablissement } from '@/lib/types'
import {
  enrichirProspect,
  SireneApiError,
  sourcerEntreprises,
  sourcerEntreprisesFallback,
  type SourcerEntreprisesParams,
} from './sourcing'
import {
  computeFiltersSignature,
  mapEffectifToTranches,
  mapRegionToCodePostal,
  mapRegionToDepartements,
} from './sourcing-mapping'
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
   * Si vide ou absent, utilise les codes NAF_PRIORITAIRES_DEFAULT.
   */
  targetSectors?: string[]
  /**
   * Code département / label région (ex: "33", "Gironde", "Nouvelle-Aquitaine").
   * Résolu via `mapRegionToCodePostal` + `mapRegionToDepartements`.
   */
  targetRegion?: string
}

export interface SourcingResult {
  runId: string
  prospectsNew: number
  prospectsUpdated: number
  duration_ms: number
}

/**
 * État de pagination Sirene persisté dans `profiles.sourcing_state`.
 * Voir migration `005_sourcing_state_and_counters.sql` pour la structure JSONB.
 */
export interface SourcingState {
  curseur?: string
  curseurSuivant?: string
  filters_signature?: string
  last_total?: number
  exhausted_at?: string | null
  last_run_at?: string
}

/**
 * Résultat de la boucle adaptative (sans étape DB ni création de run).
 * Consommé par les deux callers : `runSourcing` (UI) et `phaseSourcing` (orchestrator).
 */
export interface AdaptiveSourcingOutcome {
  /** Établissements bruts collectés avant enrichissement ADEME / scoring. */
  etablissements: SireneEtablissement[]
  /** Curseur fourni en entrée (état initial). */
  curseurInitial: string
  /** Curseur à persister pour le prochain run. */
  curseurFinal: string
  /** Signature des filtres effectivement utilisés (à persister). */
  filtersSignature: string
  /** header.total Sirene de la première page chargée (0 si fallback utilisé). */
  totalAvailable: number
  /** Nombre de pages Sirene chargées. */
  pagesLoaded: number
  /** true ssi l'univers Sirene est épuisé (`curseurSuivant === curseur`). */
  exhausted: boolean
  /** true ssi la collecte a basculé sur Recherche Entreprises (Sirene KO). */
  usedFallback: boolean
}

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

const SCORE_QUALIFICATION_SEUIL = 20
const ADEME_BATCH_SIZE = 20

// Caps de sécurité pour la boucle adaptative (cron Vercel timeout à 5 min).
const HARD_CAP_PAGES = 50
const HARD_CAP_DURATION_MS = 4 * 60 * 1000 // 4 min

// Reset du curseur si l'univers a été déclaré épuisé il y a moins de N jours
// (nouveaux établissements créés depuis dernière épuisement).
const EXHAUSTED_RESET_DAYS = 7

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
// HELPERS — RÉSOLUTION DES FILTRES EFFECTIFS
// ------------------------------------------------------------

export interface ResolvedSourcingFilters {
  /** Codes NAF normalisés (format avec point, uppercase). */
  nafCodes: string[]
  /** Codes tranche INSEE (ex. ['21','22','31','32']). */
  tranches: string[]
  /** Range CP `[min, max]` (5 chars chacun). */
  codePostalRange: [string, string]
  /** Codes département pour le fallback Recherche Entreprises. */
  departements: string[]
  /** Signature SHA-256 12 chars des filtres (pour invalidation curseur). */
  signature: string
  /** Source des NAF retenus (utile pour les logs). */
  nafSource: 'params_request' | 'settings_user' | 'naf_prioritaires_default'
}

/**
 * Résout les filtres effectifs d'un sourcing en appliquant la priorité :
 *   params.targetSectors > settings.target_sectors > NAF_PRIORITAIRES_DEFAULT.
 *
 * Calcule également les tranches, range CP, départements et signature.
 */
export function resolveSourcingFilters(
  params: SourcingParams,
  settings: ProfileSettings | null,
): ResolvedSourcingFilters {
  const nafRegex = /^\d{2}\.\d{2}[A-Z]$/
  let nafCodes: string[]
  let nafSource: ResolvedSourcingFilters['nafSource']

  if (params.targetSectors && params.targetSectors.length > 0) {
    const valid = params.targetSectors
      .map((s) => s.trim().toUpperCase())
      .filter((s) => nafRegex.test(s))
    nafCodes = valid.length > 0 ? valid : [...NAF_PRIORITAIRES_DEFAULT]
    nafSource = valid.length > 0 ? 'params_request' : 'naf_prioritaires_default'
  } else if (settings?.target_sectors && settings.target_sectors.length > 0) {
    const valid = settings.target_sectors
      .map((s) => s.trim().toUpperCase())
      .filter((s) => nafRegex.test(s))
    nafCodes = valid.length > 0 ? valid : [...NAF_PRIORITAIRES_DEFAULT]
    nafSource = valid.length > 0 ? 'settings_user' : 'naf_prioritaires_default'
  } else {
    nafCodes = [...NAF_PRIORITAIRES_DEFAULT]
    nafSource = 'naf_prioritaires_default'
  }

  const tranches = mapEffectifToTranches(params.effectifMin, params.effectifMax)
  const codePostalRange = mapRegionToCodePostal(params.targetRegion)
  const departements = mapRegionToDepartements(params.targetRegion)
  const signature = computeFiltersSignature({ tranches, codePostalRange, nafCodes })

  return { nafCodes, tranches, codePostalRange, departements, signature, nafSource }
}

// ------------------------------------------------------------
// HELPERS — sourcing_state JSONB
// ------------------------------------------------------------

/**
 * Parse `profiles.sourcing_state` (JSONB) en `SourcingState`.
 * Tolérant : retourne `{}` si la valeur est `null`, non-objet, ou shape inconnue.
 */
function parseSourcingState(raw: Json | null | undefined): SourcingState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const obj = raw as Record<string, Json | undefined>
  const state: SourcingState = {}
  if (typeof obj.curseur === 'string') state.curseur = obj.curseur
  if (typeof obj.curseurSuivant === 'string') state.curseurSuivant = obj.curseurSuivant
  if (typeof obj.filters_signature === 'string') state.filters_signature = obj.filters_signature
  if (typeof obj.last_total === 'number') state.last_total = obj.last_total
  if (typeof obj.exhausted_at === 'string') state.exhausted_at = obj.exhausted_at
  else if (obj.exhausted_at === null) state.exhausted_at = null
  if (typeof obj.last_run_at === 'string') state.last_run_at = obj.last_run_at
  return state
}

/**
 * Décide du curseur initial pour un run, en fonction de l'état persisté
 * et de la signature courante des filtres.
 *
 * Règles :
 *   - Signature ≠ stockée → reset à `*` (univers changé).
 *   - Univers déclaré épuisé il y a < 7 jours → reset à `*` (refresh).
 *   - Sinon → reprendre `state.curseurSuivant` (ou `state.curseur` à défaut).
 */
function resolveStartCurseur(
  state: SourcingState,
  signatureCurrent: string,
): { curseur: string; reason: 'fresh' | 'resume' | 'signature_changed' | 'exhausted_refresh' } {
  if (!state.filters_signature || !state.curseur) {
    return { curseur: '*', reason: 'fresh' }
  }
  if (state.filters_signature !== signatureCurrent) {
    return { curseur: '*', reason: 'signature_changed' }
  }
  if (state.exhausted_at) {
    const ageMs = Date.now() - new Date(state.exhausted_at).getTime()
    if (Number.isFinite(ageMs) && ageMs < EXHAUSTED_RESET_DAYS * 24 * 3600 * 1000) {
      return { curseur: '*', reason: 'exhausted_refresh' }
    }
  }
  const resume = state.curseurSuivant ?? state.curseur ?? '*'
  return { curseur: resume, reason: 'resume' }
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
    prospects_new: number
    prospects_updated: number
    sirene_total_available: number
    sirene_pages_loaded: number
    sirene_curseur_final: string
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
    ...(payload.prospects_new !== undefined && { prospects_new: payload.prospects_new }),
    ...(payload.prospects_updated !== undefined && { prospects_updated: payload.prospects_updated }),
    ...(payload.sirene_total_available !== undefined && { sirene_total_available: payload.sirene_total_available }),
    ...(payload.sirene_pages_loaded !== undefined && { sirene_pages_loaded: payload.sirene_pages_loaded }),
    ...(payload.sirene_curseur_final !== undefined && { sirene_curseur_final: payload.sirene_curseur_final }),
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

/**
 * Persiste `profiles.sourcing_state` après un run.
 *
 * Le client `supabase` est typé admin (service_role) car cette fonction tourne
 * en contexte cron / API route déjà autorisée. RLS est respectée car la policy
 * `profiles_update_own` filtre sur `auth.uid() = id` côté SSR — ici on utilise
 * le client admin qui bypass RLS mais filtre explicitement sur `eq('id', userId)`.
 */
async function persistSourcingState(
  userId: string,
  supabase: SupabaseAdminClient,
  state: SourcingState,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ sourcing_state: state as unknown as Json })
    .eq('id', userId)

  if (error) {
    console.log(
      JSON.stringify({
        level: 'warn',
        module: 'sourcing-runner',
        msg: 'persistSourcingState: échec mise à jour profiles.sourcing_state',
        user_id: userId,
        error: error.message,
      }),
    )
  }
}

// ------------------------------------------------------------
// BOUCLE ADAPTATIVE — factorisée et réutilisée par les deux callers
// ------------------------------------------------------------

export interface RunAdaptiveSourcingOptions {
  userId: string
  runId: string
  filters: ResolvedSourcingFilters
  /** Curseur de départ (résolu via `resolveStartCurseur`). */
  startCurseur: string
  /** SIREN à exclure (déjà en base) — muté au fil des pages. */
  sirenSet: Set<string>
  /** Cible adaptative : on stoppe la boucle quand `candidatesCollected` atteint ce seuil. */
  targetCandidates: number
  /** Callback de log structuré (pousse dans `agent_runs.logs`). */
  pushLog: (phase: string, message: string, level: 'info' | 'warn' | 'error', data?: Record<string, unknown>) => void
}

/**
 * Boucle adaptative cœur : fetch une page Sirene, dedup, continue tant que
 * `candidatesCollected < targetCandidates` ET univers non épuisé ET caps de sécurité non atteints.
 *
 * Note : la "cible" ici est exprimée en candidats POST-DEDUP, pas en qualifiés
 * post-scoring. Le scoring exact se fait en aval (coûteux ADEME). On utilise les
 * candidats comme proxy : `targetCandidates = max(daily_call_target × 3, 50)`
 * laisse une marge confortable pour la déperdition au scoring.
 *
 * Mode dégradé : si la première page Sirene throw `SireneApiError`, bascule
 * sur `sourcerEntreprisesFallback` (Recherche Entreprises) une seule fois.
 * Le fallback ne supporte pas la pagination curseur — un seul appel y suffit.
 */
export async function runAdaptiveSourcing(
  options: RunAdaptiveSourcingOptions,
): Promise<AdaptiveSourcingOutcome> {
  const { filters, startCurseur, sirenSet, targetCandidates, pushLog } = options

  const startTime = Date.now()
  const collectedEtablissements: SireneEtablissement[] = []
  let pagesLoaded = 0
  let totalAvailable = 0
  let curseurCourant = startCurseur
  let curseurFinal = startCurseur
  let exhausted = false
  let usedFallback = false

  while (collectedEtablissements.length < targetCandidates && !exhausted && pagesLoaded < HARD_CAP_PAGES) {
    if (Date.now() - startTime > HARD_CAP_DURATION_MS) {
      pushLog(
        'sourcing_loop',
        `Timeout adaptatif atteint (${HARD_CAP_DURATION_MS}ms) — arrêt boucle`,
        'warn',
        {
          pages_loaded: pagesLoaded,
          candidates_collected: collectedEtablissements.length,
          target: targetCandidates,
        },
      )
      break
    }

    const params: SourcerEntreprisesParams = {
      nafCodes: filters.nafCodes,
      effectifTranches: filters.tranches,
      codePostalRange: filters.codePostalRange,
      departements: filters.departements,
      curseur: curseurCourant,
      pageSize: 100,
      maxPages: 1, // une page par appel pour rester adaptatif
      excludeSirens: sirenSet,
    }

    let pageEtabs: SireneEtablissement[] = []
    let pageCurseurSuivant = curseurCourant
    let pagePagesLoaded = 0

    try {
      const result = await sourcerEntreprises(params)
      pageEtabs = result.etablissements
      pageCurseurSuivant = result.curseurSuivant
      pagePagesLoaded = result.pagesLoaded
      if (pagesLoaded === 0) {
        totalAvailable = result.totalAvailable
      }
      exhausted = result.exhausted
    } catch (err) {
      // SireneApiError → fallback Recherche Entreprises (une seule fois, pas de curseur)
      if (err instanceof SireneApiError && !usedFallback && pagesLoaded === 0) {
        pushLog(
          'sourcing_sirene',
          'Sirene KO → bascule sur Recherche Entreprises (fallback open data)',
          'warn',
          {
            error: err.message,
            status: err.status,
          },
        )
        try {
          const fallbackEtabs = await sourcerEntreprisesFallback({
            maxResults: Math.max(targetCandidates * 3, 200),
            nafCodes: filters.nafCodes,
            excludeSirens: sirenSet,
          })
          pageEtabs = fallbackEtabs
          // Le fallback ne pagine pas par curseur — on considère l'univers épuisé après son passage.
          pageCurseurSuivant = curseurCourant
          pagePagesLoaded = 1
          exhausted = true
          usedFallback = true
        } catch (fallbackErr) {
          pushLog(
            'sourcing_sirene',
            'FATAL: Sirene ET fallback Recherche Entreprises échoués',
            'error',
            {
              sirene_error: err.message,
              fallback_error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            },
          )
          throw new Error(
            `runAdaptiveSourcing: échec total sourcing — Sirene: ${err.message} ; fallback: ${
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
            }`,
          )
        }
      } else {
        // Erreur non-SireneApiError, ou fallback déjà tenté → propager
        throw err
      }
    }

    pagesLoaded += pagePagesLoaded
    curseurFinal = pageCurseurSuivant

    collectedEtablissements.push(...pageEtabs)
    pageEtabs.forEach((e) => sirenSet.add(e.siren))

    pushLog(
      'sourcing_page',
      `Page ${pagesLoaded} : ${pageEtabs.length} étabs (cumul ${collectedEtablissements.length})`,
      'info',
      {
        page: pagesLoaded,
        curseur: curseurCourant,
        curseurSuivant: pageCurseurSuivant,
        returned: pageEtabs.length,
        candidates_so_far: collectedEtablissements.length,
        target: targetCandidates,
        used_fallback: usedFallback,
      },
    )

    if (exhausted || usedFallback) break
    curseurCourant = pageCurseurSuivant
  }

  if (pagesLoaded >= HARD_CAP_PAGES) {
    pushLog(
      'sourcing_loop',
      `Cap pages atteint (${HARD_CAP_PAGES}) — arrêt boucle`,
      'warn',
      {
        candidates_collected: collectedEtablissements.length,
        target: targetCandidates,
      },
    )
  }

  return {
    etablissements: collectedEtablissements,
    curseurInitial: startCurseur,
    curseurFinal,
    filtersSignature: filters.signature,
    totalAvailable,
    pagesLoaded,
    exhausted,
    usedFallback,
  }
}

// ------------------------------------------------------------
// HELPERS — ENRICHISSEMENT + SCORING (factorisés)
// ------------------------------------------------------------

interface EnrichScoreOutcome {
  scored: Array<Partial<Prospect>>
  qualifiedCount: number
}

/**
 * Enrichit (ADEME BEGES, batches de 20) et score un set d'établissements.
 * Mode dégradé : un échec ADEME par SIREN logué `warn`, l'établissement passe sans BEGES.
 */
async function enrichAndScore(
  userId: string,
  etablissements: SireneEtablissement[],
  pushLog: (phase: string, message: string, level: 'info' | 'warn' | 'error', data?: Record<string, unknown>) => void,
): Promise<EnrichScoreOutcome> {
  const enrichis: Array<Partial<Prospect>> = []

  for (let i = 0; i < etablissements.length; i += ADEME_BATCH_SIZE) {
    const batch = etablissements.slice(i, i + ADEME_BATCH_SIZE)
    const batchResults = await Promise.allSettled(batch.map((etab) => enrichirProspect(etab)))

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j]
      const etab = batch[j]
      if (result.status === 'fulfilled') {
        enrichis.push({ ...result.value, user_id: userId })
      } else {
        pushLog(
          'enrichissement',
          `Enrichissement ADEME échoué pour SIREN ${etab.siren}`,
          'warn',
          {
            siren: etab.siren,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          },
        )
        // Mode dégradé : on insère quand même l'établissement (sans données BEGES)
        enrichis.push({
          siren: etab.siren,
          siret: etab.siret,
          raison_sociale:
            etab.denominationUniteLegale ??
            etab.denominationUsuelle1UniteLegale ??
            'Inconnu',
          user_id: userId,
          source: 'sirene_api',
          signaux: [],
          beges_publie: false,
          obligation_beges: false,
        })
      }
    }
  }

  pushLog('enrichissement', `${enrichis.length} prospects enrichis`, 'info')

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
  pushLog(
    'scoring',
    `${qualifiedCount} prospects qualifiés (score >= ${SCORE_QUALIFICATION_SEUIL})`,
    'info',
  )

  return { scored, qualifiedCount }
}

interface UpsertOutcome {
  prospectsNew: number
  prospectsUpdated: number
}

/**
 * Upsert un set de prospects scorés par batches de 50.
 * Compte new vs updated via l'heuristique `created_at === updated_at`.
 * Fallback : si les colonnes `beges_url`/`beges_valide` manquent (migration 004 non appliquée),
 * retry sans ces colonnes.
 */
async function upsertProspectsBatch(
  supabase: SupabaseAdminClient,
  scored: Array<Partial<Prospect>>,
  pushLog: (phase: string, message: string, level: 'info' | 'warn' | 'error', data?: Record<string, unknown>) => void,
): Promise<UpsertOutcome> {
  const UPSERT_BATCH_SIZE = 50
  let prospectsNew = 0
  let prospectsUpdated = 0

  for (let i = 0; i < scored.length; i += UPSERT_BATCH_SIZE) {
    const batch = scored.slice(i, i + UPSERT_BATCH_SIZE)
    let upsertError: { message: string } | null = null

    const result1 = await supabase
      .from('prospects')
      .upsert(batch as unknown as Database['public']['Tables']['prospects']['Insert'][], {
        onConflict: 'user_id,siren',
      })
      .select('id,created_at,updated_at')

    if (result1.error && result1.error.message.includes('beges_')) {
      const cleanBatch = batch.map(({ beges_url, beges_valide, ...rest }) => rest)
      const result2 = await supabase
        .from('prospects')
        .upsert(cleanBatch as unknown as Database['public']['Tables']['prospects']['Insert'][], {
          onConflict: 'user_id,siren',
        })
        .select('id,created_at,updated_at')
      upsertError = result2.error

      if (!result2.error) {
        pushLog('upsert', 'Migration 004 non appliquée — colonnes beges_url/beges_valide ignorées', 'warn')
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
      pushLog('upsert', `Erreur upsert batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1}`, 'warn', {
        error: upsertError.message,
        batch_size: batch.length,
      })
    }
  }

  pushLog(
    'upsert',
    `Upsert terminé : ${prospectsNew} nouveaux, ${prospectsUpdated} mis à jour`,
    'info',
    { prospects_new: prospectsNew, prospects_updated: prospectsUpdated },
  )

  return { prospectsNew, prospectsUpdated }
}

// ------------------------------------------------------------
// API PUBLIQUE : RUN ADAPTATIF END-TO-END
// (utilisée par runSourcing UI + phaseSourcing orchestrator)
// ------------------------------------------------------------

export interface PipelineSourcingInput {
  userId: string
  runId: string
  params: SourcingParams
  settings: ProfileSettings | null
  supabase: SupabaseAdminClient
  /** Callback de log structuré (pousse dans `agent_runs.logs`). */
  pushLog: (phase: string, message: string, level: 'info' | 'warn' | 'error', data?: Record<string, unknown>) => void
}

export interface PipelineSourcingOutput {
  scored: Array<Partial<Prospect>>
  qualifiedCount: number
  outcome: AdaptiveSourcingOutcome
  prospectsNew: number
  prospectsUpdated: number
}

/**
 * Exécute le sourcing adaptatif end-to-end pour un run déjà créé.
 *   1. Résout les filtres effectifs + signature
 *   2. Charge `sourcing_state` et décide du curseur initial
 *   3. Charge le sirenSet (SIREN déjà en base)
 *   4. Boucle adaptative jusqu'à N candidats OU univers épuisé
 *   5. Enrich ADEME + scoring
 *   6. Upsert
 *   7. Persiste `sourcing_state` mis à jour
 *
 * Le caller reste responsable de :
 *   - Créer le run (`agent_runs INSERT`)
 *   - Renseigner les counters Sirene dans `agent_runs` (via `outcome.*`)
 *   - Logger la fin de run et passer status='completed'
 */
export async function runPipelineSourcing(
  input: PipelineSourcingInput,
): Promise<PipelineSourcingOutput> {
  const { userId, runId, params, settings, supabase, pushLog } = input

  // 1. Filtres effectifs + signature
  const filters = resolveSourcingFilters(params, settings)
  pushLog('sourcing_init', 'Filtres résolus', 'info', {
    naf_source: filters.nafSource,
    naf_count: filters.nafCodes.length,
    tranches: filters.tranches,
    code_postal_range: filters.codePostalRange,
    departements: filters.departements,
    signature: filters.signature,
  })

  // 2. Charger sourcing_state + décider curseur initial
  const { data: profileData } = await supabase
    .from('profiles')
    .select('sourcing_state')
    .eq('id', userId)
    .single()

  const state = parseSourcingState(profileData?.sourcing_state ?? null)
  const { curseur: startCurseur, reason: startReason } = resolveStartCurseur(state, filters.signature)
  pushLog('sourcing_init', `Curseur initial: ${startCurseur} (${startReason})`, 'info', {
    state_curseur: state.curseur,
    state_signature: state.filters_signature,
    state_exhausted_at: state.exhausted_at,
  })

  // 3. SirenSet (dedup)
  const { data: existingSirens, error: sirenError } = await supabase
    .from('prospects')
    .select('siren')
    .eq('user_id', userId)
  if (sirenError) {
    pushLog('sourcing_init', 'Impossible de charger les SIREN existants — dedup désactivée', 'warn', {
      error: sirenError.message,
    })
  }
  const sirenSet = new Set<string>((existingSirens ?? []).map((r: { siren: string }) => r.siren))
  pushLog('sourcing_init', `${sirenSet.size} SIREN déjà en base (à exclure)`, 'info')

  // 4. Cible adaptative : N = max(daily_call_target × 3, 50)
  const dailyTarget = settings?.daily_call_target ?? 15
  const targetCandidates = Math.max(dailyTarget * 3, 50)

  // 5. Boucle adaptative
  const outcome = await runAdaptiveSourcing({
    userId,
    runId,
    filters,
    startCurseur,
    sirenSet,
    targetCandidates,
    pushLog,
  })

  if (outcome.etablissements.length === 0) {
    pushLog(
      'sourcing_loop',
      'Aucun nouvel établissement collecté — élargir les critères ou attendre le refresh univers',
      'warn',
      {
        total_available: outcome.totalAvailable,
        pages_loaded: outcome.pagesLoaded,
        exhausted: outcome.exhausted,
      },
    )

    await persistSourcingState(userId, supabase, {
      curseur: outcome.curseurFinal,
      curseurSuivant: outcome.curseurFinal,
      filters_signature: filters.signature,
      last_total: outcome.totalAvailable,
      exhausted_at: outcome.exhausted ? new Date().toISOString() : null,
      last_run_at: new Date().toISOString(),
    })

    return {
      scored: [],
      qualifiedCount: 0,
      outcome,
      prospectsNew: 0,
      prospectsUpdated: 0,
    }
  }

  // 6. Enrich ADEME + scoring
  const { scored, qualifiedCount } = await enrichAndScore(userId, outcome.etablissements, pushLog)

  // 7. Upsert
  const { prospectsNew, prospectsUpdated } = await upsertProspectsBatch(supabase, scored, pushLog)

  // 8. Persister sourcing_state
  await persistSourcingState(userId, supabase, {
    curseur: outcome.curseurFinal,
    curseurSuivant: outcome.curseurFinal,
    filters_signature: filters.signature,
    last_total: outcome.totalAvailable,
    exhausted_at: outcome.exhausted ? new Date().toISOString() : null,
    last_run_at: new Date().toISOString(),
  })

  return { scored, qualifiedCount, outcome, prospectsNew, prospectsUpdated }
}

// ------------------------------------------------------------
// ORCHESTRATEUR DE SOURCING PUR (UI — bouton manuel)
// ------------------------------------------------------------

/**
 * Lance un run de sourcing pur (bouton UI / `POST /api/agent/sourcing`).
 * Crée un agent_run dédié, exécute la boucle adaptative end-to-end, persiste
 * les counters Sirene et `profiles.sourcing_state`, puis marque le run completed.
 */
export async function runSourcing(
  userId: string,
  supabaseAdmin: SupabaseAdminClient,
  params: SourcingParams = {},
): Promise<SourcingResult> {
  const startedAt = new Date()
  const logs: AgentLog[] = []

  // INIT : créer le run en DB
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

  const pushLog = (
    phase: string,
    message: string,
    level: 'info' | 'warn' | 'error',
    data?: Record<string, unknown>,
  ) => {
    logs.push(log(runId, userId, phase, message, level, data))
  }

  pushLog('sourcing_init', 'Run sourcing démarré', 'info', { params })

  // SETTINGS
  let settings: ProfileSettings | null = null
  try {
    const { data: profileData } = await supabaseAdmin
      .from('profiles')
      .select('settings')
      .eq('id', userId)
      .single()
    settings = (profileData?.settings as unknown as ProfileSettings) ?? null
  } catch {
    pushLog('sourcing_init', 'Settings introuvables — paramètres par défaut utilisés', 'warn')
  }

  // PIPELINE ADAPTATIF (boucle + enrich + score + upsert + state)
  let output: PipelineSourcingOutput
  try {
    output = await runPipelineSourcing({
      userId,
      runId,
      params,
      settings,
      supabase: supabaseAdmin,
      pushLog,
    })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    pushLog('sourcing_loop', 'FATAL: pipeline adaptatif échoué', 'error', { error: errMsg })
    await updateRunInDB(runId, supabaseAdmin, {
      status: 'failed',
      phase: 'sourcing_failed',
      error_message: `Sourcing: ${errMsg}`,
      logs,
      completed_at: new Date().toISOString(),
    })
    throw new Error(`runSourcing: échec pipeline — ${errMsg}`)
  }

  // FINALISATION : counters + status completed
  const completedAt = new Date()
  const duration_ms = completedAt.getTime() - startedAt.getTime()

  pushLog('sourcing_completed', 'Run sourcing terminé avec succès', 'info', {
    prospects_new: output.prospectsNew,
    prospects_updated: output.prospectsUpdated,
    qualified: output.qualifiedCount,
    sirene_total_available: output.outcome.totalAvailable,
    sirene_pages_loaded: output.outcome.pagesLoaded,
    sirene_curseur_final: output.outcome.curseurFinal,
    exhausted: output.outcome.exhausted,
    used_fallback: output.outcome.usedFallback,
    duration_ms,
  })

  await updateRunInDB(runId, supabaseAdmin, {
    status: 'completed',
    phase: 'sourcing_completed',
    prospects_sourced: output.scored.length,
    prospects_qualified: output.qualifiedCount,
    prospects_new: output.prospectsNew,
    prospects_updated: output.prospectsUpdated,
    sirene_total_available: output.outcome.totalAvailable,
    sirene_pages_loaded: output.outcome.pagesLoaded,
    sirene_curseur_final: output.outcome.curseurFinal,
    logs,
    completed_at: completedAt.toISOString(),
  })

  return {
    runId,
    prospectsNew: output.prospectsNew,
    prospectsUpdated: output.prospectsUpdated,
    duration_ms,
  }
}
