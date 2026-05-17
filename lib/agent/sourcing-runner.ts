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

import { captureWithContext } from '@/lib/observability/sentry-helpers'
import type { Database, Json } from '@/lib/supabase/database.types'
import type { SupabaseAdminClient } from '@/lib/supabase/server'
import type {
  AgentLog,
  AgentRun,
  ProfileSettings,
  Prospect,
  ScoringWeights,
  SireneEtablissement,
} from '@/lib/types'
import {
  categoriserSecteurAvecGemini,
  isGeminiAvailable,
} from './gemini-scoring'
import { resolveSectorFromNaf } from './naf-labels'
import {
  enrichirProspect,
  getRePhoneCircuitState,
  resetRePhoneCircuit,
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
import {
  matchesAnyNaf,
  resolveNafFromInput,
} from './naf-sector-mapping'
import { calculerScore, determinerPriorite, getScoreDetails } from './scoring'
import { searchSireneCache } from './sirene-cache'

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

/**
 * Résultat exposé au caller HTTP (`POST /api/agent/sourcing`).
 *
 * Wave 3 (F-IMP-01 + F-IMP-04) — on inclut désormais les counters Sirene
 * (`totalAvailable`, `pagesLoaded`, `curseurFinal`, `exhausted`, `usedFallback`)
 * et `prospectsQualified`, qui étaient calculés mais jetés. Cf. modal
 * `components/dashboard/sourcing-modal.tsx:81-104` (champs `prospectsQualified`,
 * `totalAvailable`, `exhausted`, `pagesLoaded`).
 *
 * `duration_ms` est conservé en snake_case pour compatibilité legacy avec
 * la modal qui tolère les deux formes (`durationMs` Task 2.3 ou `duration_ms`).
 */
export interface SourcingResult {
  runId: string
  prospectsSourced: number
  prospectsQualified: number
  prospectsNew: number
  prospectsUpdated: number
  /** header.total Sirene de la 1ère page (0 si fallback Recherche Entreprises). */
  totalAvailable: number
  pagesLoaded: number
  /** true ssi l'univers Sirene est épuisé (`curseurSuivant === curseur`). */
  exhausted: boolean
  /** true ssi univers vide (404 Sirene 1ère page) — distinct de exhausted. */
  universeEmpty: boolean
  /** Dernier `curseurSuivant` persisté dans `profiles.sourcing_state`. */
  curseurFinal: string
  /** true ssi la collecte a basculé sur Recherche Entreprises (Sirene KO). */
  usedFallback: boolean
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
  /** true ssi Sirene a renvoyé 404 sur la 1ère page (univers vide pour ces filtres). */
  universeEmpty: boolean
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

// Soft timeout pour la phase d'enrichissement (ADEME + téléphone Recherche Entreprises).
// Au-delà, on coupe et on persiste les prospects partiellement enrichis (upsert idempotent —
// les SIREN ignorés seront retentés au prochain run via la même cascade).
// Calibré pour laisser ~80s de budget pour upsert + finalisation côté Vercel 300s.
const ENRICH_SOFT_TIMEOUT_MS = 180 * 1000

// Cap d'établissements à enrichir par run (anti-timeout supplémentaire au cas où
// Recherche Entreprises répond lentement sans déclencher le circuit breaker).
// 80 × ~2s/SIREN (ADEME parallèle + tel) ≈ 160s — confortable sous le soft timeout.
const ENRICH_MAX_ETABLISSEMENTS = 80

/**
 * Cap STRICT de catégorisation secteur Gemini par run sourcing (UI bouton manuel).
 * Plus restrictif que la phase nocturne (50) pour préserver le quota Gemini gratuit
 * (1500 req/jour, 30 req/min) face à des sourcings UI répétés.
 */
const SECTEUR_MAX_PER_SOURCING_RUN = 20

/** Parallélisme du batch catégorisation (rate-limit Gemini Flash 30 req/min). */
const SECTEUR_BATCH_PARALLELISM = 5

/**
 * Intervalle du heartbeat (ms) — pousse un log "vivant" dans `agent_runs.logs`
 * toutes les 30s. Permet de localiser la phase du run au moment du kill quand
 * Vercel termine la fonction sur timeout 300s sans nous laisser logguer le
 * vrai message d'erreur. Cf. bug B 2026-05-12 (timeout enrichissement contact).
 */
const HEARTBEAT_INTERVAL_MS = 30_000

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
 * Accepte aussi bien des codes NAF (`01.21Z`, `0121Z`) que des libellés UI
 * (`Industrie manufacturière`) via `resolveNafFromInput` — fix 2026-05-14
 * du bug de catégorisation NAF (UI Settings stocke des libellés humains).
 *
 * Calcule également les tranches, range CP, départements et signature.
 */
export function resolveSourcingFilters(
  params: SourcingParams,
  settings: ProfileSettings | null,
): ResolvedSourcingFilters {
  let nafCodes: string[]
  let nafSource: ResolvedSourcingFilters['nafSource']

  const resolveFromInputs = (
    items: readonly string[],
    sourceTag: 'params_request' | 'settings_user',
  ): { codes: string[]; source: ResolvedSourcingFilters['nafSource'] } => {
    const { codes, unknownLabels, unmappedLabels } = resolveNafFromInput(items)
    if (unknownLabels.length > 0 || unmappedLabels.length > 0) {
      // Log non-fatal — l'utilisateur saura que sa sélection contient
      // des libellés ignorés. PII safe : on log uniquement les labels (texte
      // UI public, pas de donnée prospect).
      console.log(
        JSON.stringify({
          level: 'warn',
          module: 'sourcing-runner',
          msg: 'Certains libellés/codes secteurs n\'ont pas été résolus',
          source: sourceTag,
          unknown_labels: unknownLabels,
          unmapped_labels: unmappedLabels,
          resolved_codes_count: codes.length,
        }),
      )
    }
    if (codes.length > 0) return { codes, source: sourceTag }
    return { codes: [...NAF_PRIORITAIRES_DEFAULT], source: 'naf_prioritaires_default' }
  }

  if (params.targetSectors !== undefined) {
    // Le caller a explicitement fourni une liste (modal ou route). Si tableau
    // vide → l'utilisateur veut PAS DE FILTRE NAF (pas de fallback sur le
    // default). Cf. LOT-C 2026-05-17 : sourcing-modal envoie volontairement
    // [] pour simplifier la query Sirene (cause HTTP 400 historique).
    if (params.targetSectors.length > 0) {
      const resolved = resolveFromInputs(params.targetSectors, 'params_request')
      nafCodes = resolved.codes
      nafSource = resolved.source
    } else {
      nafCodes = []
      nafSource = 'params_request'
    }
  } else if (settings?.target_sectors && settings.target_sectors.length > 0) {
    const resolved = resolveFromInputs(settings.target_sectors, 'settings_user')
    nafCodes = resolved.codes
    nafSource = resolved.source
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
// HEARTBEAT — détection post-mortem des timeouts Vercel
// ------------------------------------------------------------

/**
 * État partagé du run en cours, lu par le heartbeat pour savoir où on est resté.
 * Muté par la boucle principale ; le heartbeat ne le mute jamais.
 */
export interface HeartbeatState {
  /** Phase courante du pipeline (sourcing_init, sourcing_loop, enrichissement, upsert, ...). */
  phase: string
  /** Compteurs incrémentaux pour le diag (pages, candidats, batch en cours). */
  counters: Record<string, number | string>
}

/**
 * Démarre un heartbeat qui pousse un log toutes les `HEARTBEAT_INTERVAL_MS` ms
 * dans `agent_runs.logs` (via le `pushLog` fourni) ET console (JSON struct).
 *
 * Retourne une fonction `stop()` à appeler dans un finally pour cleanup propre.
 * Idempotent : appeler stop() plusieurs fois est sans effet.
 *
 * Pourquoi : Vercel kill la fonction à 300s sans nous laisser logguer une erreur.
 * Sans heartbeat, on ne sait pas si le run est mort en sourcing, enrichment, etc.
 * Avec heartbeat, le dernier log persisté avant la mort indique la phase.
 */
export function startHeartbeat(
  state: HeartbeatState,
  pushLog: (phase: string, message: string, level: 'info' | 'warn' | 'error', data?: Record<string, unknown>) => void,
  intervalMs: number = HEARTBEAT_INTERVAL_MS,
): () => void {
  let stopped = false
  const start = Date.now()

  const interval = setInterval(() => {
    if (stopped) return
    pushLog('heartbeat', 'Run actif (heartbeat)', 'info', {
      current_phase: state.phase,
      elapsed_ms: Date.now() - start,
      counters: { ...state.counters },
    })
  }, intervalMs)

  // unref évite que le heartbeat empêche le process Node de se terminer
  // si le run finit avant l'intervalle (env. test ou cold-start abandonné).
  if (typeof interval.unref === 'function') interval.unref()

  return () => {
    if (stopped) return
    stopped = true
    clearInterval(interval)
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
  /**
   * Si `true` (settings.prefer_fallback_recherche_entreprises = true), court-circuite
   * l'appel Sirene et passe directement par `sourcerEntreprisesFallback` (Recherche
   * Entreprises). Use case : Sirene HTTP 400 / 5xx récurrents (cf. bug prod 2026-05-17).
   * Défaut `false` = comportement legacy (Sirene puis fallback réactif sur erreur).
   */
  preferFallback?: boolean
  /**
   * Client Supabase admin pour consulter le cache SIRENE local (migration 018+019).
   * Si fourni, le cache est tenté EN PREMIER (zéro appel API). En cas de cache vide
   * ou obsolète (> 60j), bascule transparente sur l'API Sirene live (comportement
   * legacy). Optional pour préserver la rétrocompatibilité des tests directs
   * qui n'instancient pas de client Supabase.
   */
  supabase?: SupabaseAdminClient
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
  const { filters, startCurseur, sirenSet, targetCandidates, pushLog, preferFallback, supabase } = options

  const startTime = Date.now()
  const collectedEtablissements: SireneEtablissement[] = []
  let pagesLoaded = 0
  let totalAvailable = 0
  let curseurCourant = startCurseur
  let curseurFinal = startCurseur
  let exhausted = false
  let universeEmpty = false
  let usedFallback = false

  // ----------------------------------------------------------------
  // MODE PRÉFÉRENCE FALLBACK — court-circuit Sirene
  // ----------------------------------------------------------------
  // Si l'utilisateur a explicitement préféré Recherche Entreprises (settings),
  // on n'appelle JAMAIS Sirene. Utile en production tant que l'API INSEE est
  // instable (cf. bug HTTP 400 prod 2026-05-17 — chunks NAF rejetés malgré
  // les fixes successifs). On considère l'univers épuisé après un seul passage
  // fallback (pas de pagination curseur côté Recherche Entreprises).
  if (preferFallback) {
    pushLog(
      'sourcing_sirene',
      'Skip Sirene — settings.prefer_fallback_recherche_entreprises = true',
      'warn',
      { target_candidates: targetCandidates },
    )
    try {
      const fallbackEtabs = await sourcerEntreprisesFallback({
        maxResults: Math.max(targetCandidates * 3, 200),
        nafCodes: filters.nafCodes,
        effectifTranches: filters.tranches,
        departements: filters.departements,
        excludeSirens: sirenSet,
      })
      // Garde NAF (cohérent avec la branche legacy ligne ~670).
      const filteredByNaf = fallbackEtabs.filter((e) =>
        matchesAnyNaf(e.activitePrincipaleEtablissement, filters.nafCodes),
      )
      filteredByNaf.forEach((e) => sirenSet.add(e.siren))
      pushLog(
        'sourcing_page',
        `Fallback direct : ${filteredByNaf.length} étabs collectés`,
        'info',
        {
          collected: filteredByNaf.length,
          dropped_by_naf: fallbackEtabs.length - filteredByNaf.length,
          target: targetCandidates,
          used_fallback: true,
        },
      )
      return {
        etablissements: filteredByNaf,
        curseurInitial: startCurseur,
        curseurFinal: startCurseur,
        filtersSignature: filters.signature,
        totalAvailable: 0,
        pagesLoaded: 1,
        exhausted: true,
        universeEmpty: filteredByNaf.length === 0,
        usedFallback: true,
      }
    } catch (err) {
      // Le fallback direct a échoué — on n'a pas de plan B (Sirene KO supposé par config).
      pushLog(
        'sourcing_sirene',
        'FATAL: fallback Recherche Entreprises (mode préférence) échoué',
        'error',
        { error: err instanceof Error ? err.message : String(err) },
      )
      captureWithContext(err, {
        pipeline_phase: 'sourcing',
        api: 'recherche_entreprises',
        run_id: options.runId,
        user_id: options.userId,
        extra: { phase: 'sourcing_prefer_fallback_failure' },
      })
      throw new Error(
        `runAdaptiveSourcing: fallback préféré échoué — ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  // ----------------------------------------------------------------
  // CACHE SIRENE LOCAL — tentative préalable (migration 018+019)
  // ----------------------------------------------------------------
  // Avant d'attaquer l'API Sirene live (instable + throttle 30 req/min),
  // on tente une lecture du miroir local Supabase. Si frais (< 60j) :
  //   - zéro appel réseau externe ;
  //   - une seule requête PostgreSQL via la fonction PL/pgSQL ;
  //   - retour direct au caller avec exhausted=true (le cache embarque
  //     l'univers entier — pas de notion de curseur incrémental).
  // Si null (vide / obsolète / erreur Supabase) → bascule transparente
  // sur la boucle Sirene legacy ci-dessous.
  if (supabase) {
    try {
      const cacheResult = await searchSireneCache(supabase, {
        nafCodes: filters.nafCodes,
        trancheEffectifs: filters.tranches,
        codePostalRange: filters.codePostalRange,
        excludeSirens: [...sirenSet],
        // Cible : on demande exactement targetCandidates×2 pour garder une marge
        // après le filtre matchesAnyNaf (au cas où le cache contiendrait des NAF
        // hors-cible — peu probable, mais cohérent avec la garde post-fetch
        // appliquée à l'API Sirene live).
        pageSize: Math.max(targetCandidates * 2, 100),
        offset: 0,
      })

      if (cacheResult) {
        const beforeNafFilter = cacheResult.etablissements.length
        const filteredByNaf = cacheResult.etablissements.filter((e) =>
          matchesAnyNaf(e.activitePrincipaleEtablissement, filters.nafCodes),
        )
        filteredByNaf.forEach((e) => sirenSet.add(e.siren))
        pushLog(
          'sourcing_sirene',
          `Cache SIRENE utilisé (zéro appel API) — ${filteredByNaf.length} étabs`,
          'info',
          {
            cache_age_days: cacheResult.cacheAgeDays,
            rows_returned: beforeNafFilter,
            kept_after_naf_filter: filteredByNaf.length,
            target_candidates: targetCandidates,
          },
        )

        return {
          etablissements: filteredByNaf,
          curseurInitial: startCurseur,
          // Le cache n'a pas de notion de curseur incrémental — on conserve le
          // curseur initial pour ne pas casser la signature de filtres / persistance.
          curseurFinal: startCurseur,
          filtersSignature: filters.signature,
          totalAvailable: beforeNafFilter,
          pagesLoaded: 1,
          // exhausted=true : le cache embarque l'univers complet pour ces filtres ;
          // un prochain run rejouera la même requête (dedup via sirenSet en base).
          exhausted: true,
          universeEmpty: filteredByNaf.length === 0,
          // usedFallback=false : le cache n'est PAS le fallback Recherche Entreprises.
          // C'est une source distincte (mirroir INSEE local).
          usedFallback: false,
        }
      } else {
        // null = cache vide ou obsolète. Le log est déjà émis par searchSireneCache
        // (niveau info/warn structuré). On bascule sur la boucle Sirene legacy.
        pushLog(
          'sourcing_sirene',
          'Cache SIRENE vide ou obsolète — bascule sur API Sirene live',
          'info',
          { target_candidates: targetCandidates },
        )
      }
    } catch (err) {
      // Erreur inattendue côté cache → on log + continue avec l'API live.
      // Pas de Sentry : `searchSireneCache` retourne null sur les erreurs prévues.
      pushLog(
        'sourcing_sirene',
        'Erreur inattendue cache SIRENE — bascule sur API Sirene live',
        'warn',
        { error: err instanceof Error ? err.message : String(err) },
      )
    }
  }

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
        universeEmpty = result.universeEmpty
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
            effectifTranches: filters.tranches,
            departements: filters.departements,
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
          // Échec total des deux sources — alerting Sentry obligatoire (pas de fallback restant).
          captureWithContext(fallbackErr, {
            pipeline_phase: 'sourcing',
            api: 'recherche_entreprises',
            run_id: options.runId,
            user_id: options.userId,
            extra: {
              phase: 'sourcing_fallback_total_failure',
              sirene_error: err.message,
              sirene_status: err.status,
            },
          })
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

    // Garde post-fetch : si la query Lucene ou l'API fallback a fuité un NAF
    // hors-cible (bug API ou normalisation), on l'exclut ici avant insert DB.
    // `matchesAnyNaf` tolère les formats avec/sans point. Si `filters.nafCodes`
    // est vide, `matchesAnyNaf` retourne `true` — pas de régression legacy.
    const beforeNafFilter = pageEtabs.length
    const filteredByNaf = pageEtabs.filter((e) =>
      matchesAnyNaf(e.activitePrincipaleEtablissement, filters.nafCodes),
    )
    const droppedByNaf = beforeNafFilter - filteredByNaf.length
    if (droppedByNaf > 0) {
      pushLog(
        'sourcing_page',
        `${droppedByNaf} établissement(s) écartés (NAF hors-cible) page ${pagesLoaded}`,
        'warn',
        {
          page: pagesLoaded,
          dropped: droppedByNaf,
          kept: filteredByNaf.length,
          used_fallback: usedFallback,
        },
      )
    }

    collectedEtablissements.push(...filteredByNaf)
    filteredByNaf.forEach((e) => sirenSet.add(e.siren))

    pushLog(
      'sourcing_page',
      `Page ${pagesLoaded} : ${filteredByNaf.length} étabs (cumul ${collectedEtablissements.length})`,
      'info',
      {
        page: pagesLoaded,
        curseur: curseurCourant,
        curseurSuivant: pageCurseurSuivant,
        returned: filteredByNaf.length,
        returned_before_naf_filter: beforeNafFilter,
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
    universeEmpty,
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
 * Construit un prospect en mode dégradé (sans BEGES ni téléphone) à partir d'un
 * établissement Sirene. Utilisé quand l'enrichissement ADEME ou Recherche Entreprises
 * échoue ou est skip (cap / soft timeout).
 *
 * L'upsert sur `(user_id, siren)` est idempotent → un prochain run réessaiera
 * l'enrichissement complet pour ces SIREN.
 */
function buildDegradedProspect(
  etab: SireneEtablissement,
  userId: string,
): Partial<Prospect> {
  return {
    siren: etab.siren,
    siret: etab.siret,
    raison_sociale:
      etab.denominationUniteLegale ??
      etab.denominationUsuelle1UniteLegale ??
      'Inconnu',
    // On préserve le code NAF brut Sirene même en mode dégradé : la résolution
    // du libellé (`secteur_libelle`) se fera côté UI via la cascade
    // `resolveSectorLabel` dans `lib/pipeline/analytics.ts`. Évite que les
    // SIREN insérés en mode dégradé (timeout / cap enrichissement) ne soient
    // tous classés "Secteur inconnu" dans le top sectors.
    secteur_naf: etab.activitePrincipaleEtablissement,
    user_id: userId,
    source: 'sirene_api',
    signaux: [],
    beges_publie: false,
    obligation_beges: false,
  }
}

/**
 * Enrichit (ADEME BEGES, batches de 20) et score un set d'établissements.
 *
 * Garde-fous anti-timeout Vercel 300s (fix 2026-05-12) :
 *   - Cap dur : `ENRICH_MAX_ETABLISSEMENTS` (80) — au-delà, les surnuméraires
 *     sont insérés en mode dégradé (sans BEGES ni tel) et seront retentés
 *     au prochain run (upsert idempotent sur `(user_id, siren)`).
 *   - Soft timeout : `ENRICH_SOFT_TIMEOUT_MS` (180s) — dès qu'il est dépassé
 *     entre deux batches, on arrête `enrichirProspect()` et on bascule les
 *     restants en mode dégradé.
 *
 * Mode dégradé : un échec ADEME par SIREN logué `warn`, l'établissement passe sans BEGES.
 */
async function enrichAndScore(
  userId: string,
  etablissements: SireneEtablissement[],
  pushLog: (phase: string, message: string, level: 'info' | 'warn' | 'error', data?: Record<string, unknown>) => void,
  scoringWeights?: ScoringWeights,
): Promise<EnrichScoreOutcome> {
  // Reset du circuit breaker téléphone au début de chaque phase d'enrichissement.
  // Cohérent avec la philosophie "1 run = 1 budget réseau" : on retente RE même
  // si une instance Vercel chaude a connu une panne précédente.
  resetRePhoneCircuit()

  const enrichis: Array<Partial<Prospect>> = []
  const phaseStartedAt = Date.now()

  // Cap dur : au-delà de ENRICH_MAX_ETABLISSEMENTS, on insère en mode dégradé.
  // Les SIREN sont triés par ordre d'arrivée Sirene (déjà priorisés par tranche).
  const toEnrich = etablissements.slice(0, ENRICH_MAX_ETABLISSEMENTS)
  const overflow = etablissements.slice(ENRICH_MAX_ETABLISSEMENTS)

  if (overflow.length > 0) {
    pushLog(
      'enrichissement',
      `Cap d'enrichissement atteint — ${overflow.length} SIREN insérés en mode dégradé (seront retentés au prochain run)`,
      'warn',
      {
        cap: ENRICH_MAX_ETABLISSEMENTS,
        overflow: overflow.length,
        total: etablissements.length,
      },
    )
  }

  let softTimeoutTriggered = false
  let processedCount = 0

  for (let i = 0; i < toEnrich.length; i += ADEME_BATCH_SIZE) {
    // Vérification soft timeout entre les batches (pas au milieu — on laisse
    // le batch en cours se terminer pour éviter de gâcher les appels en vol).
    if (Date.now() - phaseStartedAt > ENRICH_SOFT_TIMEOUT_MS) {
      softTimeoutTriggered = true
      const restants = toEnrich.length - processedCount
      pushLog(
        'enrichissement',
        `Soft timeout enrichissement atteint (${ENRICH_SOFT_TIMEOUT_MS}ms) — ${restants} SIREN restants insérés en mode dégradé`,
        'warn',
        {
          processed: processedCount,
          remaining: restants,
          timeout_ms: ENRICH_SOFT_TIMEOUT_MS,
        },
      )
      // Bascule les restants vers le mode dégradé via la branche overflow ci-dessous.
      const skipped = toEnrich.slice(processedCount)
      for (const etab of skipped) {
        enrichis.push(buildDegradedProspect(etab, userId))
      }
      break
    }

    const batch = toEnrich.slice(i, i + ADEME_BATCH_SIZE)
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
        enrichis.push(buildDegradedProspect(etab, userId))
      }
    }
    processedCount += batch.length
  }

  // Overflow : insère les SIREN au-delà du cap en mode dégradé.
  for (const etab of overflow) {
    enrichis.push(buildDegradedProspect(etab, userId))
  }

  // Logging final du state du circuit breaker téléphone (visible côté agent_runs).
  const circuitState = getRePhoneCircuitState()
  if (circuitState.open) {
    pushLog(
      'enrichment_contact',
      `Circuit breaker RE activé après ${circuitState.consecutiveFailures} échecs consécutifs — enrichissement partiel`,
      'warn',
      {
        enrichis_ok: processedCount,
        skip_rest: enrichis.length - processedCount,
        soft_timeout_triggered: softTimeoutTriggered,
      },
    )
  }

  pushLog('enrichissement', `${enrichis.length} prospects enrichis`, 'info', {
    processed: processedCount,
    degraded: enrichis.length - processedCount,
    soft_timeout_triggered: softTimeoutTriggered,
    re_phone_circuit_open: circuitState.open,
    re_phone_consecutive_failures: circuitState.consecutiveFailures,
  })

  // Pondération scoring : settings.scoring_weights si présent, sinon défauts 30/30/40.
  // `calculerScore` normalise systématiquement les weights — pas besoin de pré-traiter.
  const scored: Array<Partial<Prospect>> = enrichis.map((p) => {
    const score = calculerScore(p, false, scoringWeights)
    const details = getScoreDetails(p, false, scoringWeights)
    // priorite qualitative (haute/moyenne/basse) déduite du score numérique.
    // Persistée pour éviter le défaut DB 'moyenne' systématique sur tous les nouveaux prospects.
    return {
      ...p,
      score_priorite: score,
      score_details: details,
      priorite: determinerPriorite(score),
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

  // Migration 017 — préservation du statut 'do_not_contact' à l'upsert.
  // ---------------------------------------------------------------------
  // L'utilisateur peut avoir basculé un prospect en `do_not_contact` (opt-out
  // RGPD manuel). L'upsert `onConflict: 'user_id,siren'` écraserait ce statut
  // par 'qualified' / 'sourced' calculé au scoring. Pour préserver la décision
  // utilisateur (et rester idempotent), on récupère pour ce user la liste des
  // SIREN flaggés `do_not_contact` puis on STRIP `statut` (et `priorite`,
  // éditée manuellement) des payloads concernés. Les autres champs (BEGES,
  // score, contact) continuent à être rafraîchis normalement.
  const userIds = new Set(scored.map((p) => p.user_id).filter((u): u is string => Boolean(u)))
  const doNotContactSirens = new Set<string>()
  for (const uid of userIds) {
    const { data, error } = await supabase
      .from('prospects')
      .select('siren')
      .eq('user_id', uid)
      .eq('statut', 'do_not_contact')
    if (error) {
      pushLog(
        'upsert',
        'Lecture do_not_contact impossible — risque d\'écrasement statut, on continue best-effort',
        'warn',
        { error: error.message, user_id: uid },
      )
      continue
    }
    for (const row of (data ?? []) as Array<{ siren: string }>) {
      doNotContactSirens.add(row.siren)
    }
  }

  if (doNotContactSirens.size > 0) {
    pushLog(
      'upsert',
      `${doNotContactSirens.size} prospect(s) en do_not_contact — statut préservé`,
      'info',
      { count: doNotContactSirens.size },
    )
  }

  // Strip `statut` + `priorite` des payloads qui matchent un SIREN do_not_contact.
  // Pas de mutation in-place — on remplace par une copie nettoyée.
  const protectedScored: Array<Partial<Prospect>> = scored.map((p) => {
    if (p.siren && doNotContactSirens.has(p.siren)) {
      const { statut: _s, priorite: _p, ...rest } = p
      void _s
      void _p
      return rest
    }
    return p
  })

  for (let i = 0; i < protectedScored.length; i += UPSERT_BATCH_SIZE) {
    const batch = protectedScored.slice(i, i + UPSERT_BATCH_SIZE)
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
// HELPER — Catégorisation secteur inline (Gemini Flash 2.0)
// ------------------------------------------------------------

/**
 * Catégorise les prospects sans `secteur_libelle` après upsert.
 *
 * Limites strictes :
 *   - Cap à `SECTEUR_MAX_PER_SOURCING_RUN` prospects (préserve quota Gemini gratuit).
 *   - Batch parallèle de `SECTEUR_BATCH_PARALLELISM` (rate-limit Gemini Flash).
 *   - Skip silencieux si `GEMINI_API_KEY` absente.
 *   - `categoriserSecteurAvecGemini` retourne `null` en cas d'échec → pas de crash.
 *
 * Optionnel : un échec ici ne propage jamais d'exception (try/catch interne).
 */
async function categoriserSecteursPostUpsert(
  userId: string,
  supabase: SupabaseAdminClient,
  scored: Array<Partial<Prospect>>,
  pushLog: (phase: string, message: string, level: 'info' | 'warn' | 'error', data?: Record<string, unknown>) => void,
): Promise<void> {
  try {
    // Cible : nouveaux prospects sourcés sans secteur_libelle mais avec NAF dispo.
    // Le filtre inclut désormais la valeur littérale "Inconnu*" en plus de NULL/vide.
    const isMissingSecteur = (s: string | undefined | null): boolean => {
      if (!s) return true
      const trimmed = s.trim()
      if (trimmed === '') return true
      return /^inconnu/i.test(trimmed)
    }

    const sirensSansSecteur = scored
      .filter(
        (p) =>
          p.siren &&
          p.secteur_naf &&
          isMissingSecteur(p.secteur_libelle),
      )
      .slice(0, SECTEUR_MAX_PER_SOURCING_RUN)
      .map((p) => p.siren as string)

    if (sirensSansSecteur.length === 0) {
      pushLog(
        'secteur_categorisation',
        'Catégorisation : 0 prospects sélectionnés — tous ont déjà un secteur_libelle',
        'info',
        { selected: 0, cap: SECTEUR_MAX_PER_SOURCING_RUN },
      )
      return
    }

    // On relit depuis la DB pour récupérer l'id (clef de l'UPDATE).
    const { data: rows, error } = await supabase
      .from('prospects')
      .select('id, siren, raison_sociale, secteur_naf, effectif_min')
      .eq('user_id', userId)
      .in('siren', sirensSansSecteur)

    if (error || !rows || rows.length === 0) {
      if (error) {
        pushLog('secteur_categorisation', 'Lecture prospects pour catégorisation impossible', 'warn', {
          error: error.message,
        })
      } else {
        pushLog(
          'secteur_categorisation',
          'Catégorisation : 0 rows DB pour les SIREN sélectionnés — incohérence ?',
          'warn',
          { siren_count: sirensSansSecteur.length },
        )
      }
      return
    }

    // Cascade : pour chaque prospect, on tente d'abord la résolution déterministe
    // via le mapping NAF rev. 2 INSEE (lib/agent/naf-labels.ts). Si null, on
    // bascule sur Gemini en fallback. Évite 99% des appels Gemini (NAF présent
    // sur la quasi-totalité des prospects sourcés depuis sirene_cache).
    let resolusParNaf = 0
    let categorisesParGemini = 0
    let echecsCount = 0
    const rowsBesoinGemini: typeof rows = []

    for (const r of rows) {
      const nafResult = resolveSectorFromNaf((r.secteur_naf as string | null) ?? null)
      if (nafResult) {
        const { error: updateError } = await supabase
          .from('prospects')
          .update({ secteur_libelle: nafResult.libelle })
          .eq('id', r.id as string)
        if (updateError) {
          echecsCount += 1
        } else {
          resolusParNaf += 1
        }
      } else {
        rowsBesoinGemini.push(r)
      }
    }

    // Fallback Gemini pour les prospects sans NAF résoluble.
    if (rowsBesoinGemini.length > 0 && isGeminiAvailable()) {
      for (let groupStart = 0; groupStart < rowsBesoinGemini.length; groupStart += SECTEUR_BATCH_PARALLELISM) {
        const groupEnd = Math.min(groupStart + SECTEUR_BATCH_PARALLELISM, rowsBesoinGemini.length)
        const group = rowsBesoinGemini.slice(groupStart, groupEnd)

        const results = await Promise.all(
          group.map(async (r) => {
            const result = await categoriserSecteurAvecGemini({
              nafCode: (r.secteur_naf as string | null) ?? null,
              raisonSociale: (r.raison_sociale as string | null) ?? '',
              effectifMin: (r.effectif_min as number | null) ?? null,
            })
            return { id: r.id as string, result }
          }),
        )

        for (const { id, result } of results) {
          if (!result) {
            echecsCount += 1
            continue
          }
          const { error: updateError } = await supabase
            .from('prospects')
            .update({ secteur_libelle: result.secteur_libelle })
            .eq('id', id)
          if (updateError) {
            echecsCount += 1
            continue
          }
          categorisesParGemini += 1
        }
      }
    } else if (rowsBesoinGemini.length > 0) {
      // Gemini indisponible et NAF non résoluble → on log mais on ne plante pas.
      echecsCount += rowsBesoinGemini.length
    }

    pushLog(
      'secteur_categorisation',
      `Catégorisation : ${rows.length} sélectionnés, ${resolusParNaf} via NAF, ${categorisesParGemini} via Gemini, ${echecsCount} échecs`,
      'info',
      {
        selected: rows.length,
        resolus_par_naf: resolusParNaf,
        categorises_par_gemini: categorisesParGemini,
        echecs: echecsCount,
        cap: SECTEUR_MAX_PER_SOURCING_RUN,
        gemini_available: isGeminiAvailable(),
        source: 'naf-labels + gemini-2.0-flash',
      },
    )
  } catch (err) {
    // Phase strictement optionnelle — on n'interrompt jamais le sourcing.
    pushLog('secteur_categorisation', 'Catégorisation secteur (sourcing) — erreur silencieuse', 'warn', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
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

  // Heartbeat : log toutes les 30s la phase courante du pipeline pour permettre
  // un diag post-mortem en cas de Vercel timeout 300s (cf. HEARTBEAT_INTERVAL_MS).
  const hbState: HeartbeatState = {
    phase: 'sourcing_init',
    counters: { pages_loaded: 0, candidates_collected: 0 },
  }
  const stopHeartbeat = startHeartbeat(hbState, pushLog)

  try {
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
  // Note : Supabase coupe par défaut à 1000 rows. Le dedup peut donc être
  // partiel au-delà — l'upsert `onConflict: 'user_id,siren'` rattrape les
  // collisions, mais `nouveaux_apres_dedup` peut être surestimé. Acceptable
  // pour l'instant (volume cible 1500-5k prospects par user).
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

  // 4. Cible adaptative : N = max(sourcing_target_per_run × 3, 50)
  const dailyTarget = settings?.sourcing_target_per_run ?? 15
  const targetCandidates = Math.max(dailyTarget * 3, 50)

  // 5. Boucle adaptative + enrich + score + upsert
  //
  // Wave 3 (F-IMP-05) — On enveloppe le cœur du pipeline dans un try/finally
  // pour garantir que `sourcing_state` est persisté dans TOUS les cas (succès,
  // erreur enrich, erreur upsert, timeout). Sans cela, si la boucle a déjà
  // chargé N pages avant un crash, le curseur avancé est perdu → run suivant
  // repart de `*` et refetche les pages déjà vues = symptôme du plateau initial.
  //
  // Stratégie : tout ce qui touche au curseur Sirene est tenté DANS le try ;
  // le finally persiste l'état avec les valeurs courantes au moment du throw
  // (cf. `runAdaptiveSourcing` qui retourne TOUJOURS un outcome bien formé,
  // sauf en cas d'échec total Sirene + fallback — auquel cas il throw avant
  // toute affectation et `outcome` reste `null` ; le finally skip alors la
  // persistance car aucun curseur n'a été consommé).
  let outcome: AdaptiveSourcingOutcome | null = null
  let scored: Array<Partial<Prospect>> = []
  let qualifiedCount = 0
  let prospectsNew = 0
  let prospectsUpdated = 0

  try {
    // 5a. Boucle adaptative
    hbState.phase = 'sourcing_loop'
    outcome = await runAdaptiveSourcing({
      userId,
      runId,
      filters,
      startCurseur,
      sirenSet,
      targetCandidates,
      pushLog,
      // Permet au user de court-circuiter Sirene en cas de pannes récurrentes
      // (cf. bug HTTP 400 prod 2026-05-17). Défaut `false` = comportement legacy.
      preferFallback: settings?.prefer_fallback_recherche_entreprises === true,
      // Active le cache SIRENE local (migration 018+019) : tenté en PREMIER,
      // fallback API Sirene live si vide / obsolète. Voir `lib/agent/sirene-cache.ts`.
      supabase,
    })
    hbState.counters.pages_loaded = outcome.pagesLoaded
    hbState.counters.candidates_collected = outcome.etablissements.length

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
    } else {
      // 5b. Enrich ADEME + scoring
      hbState.phase = 'enrichissement'
      const enrichResult = await enrichAndScore(
        userId,
        outcome.etablissements,
        pushLog,
        settings?.scoring_weights,
      )
      scored = enrichResult.scored
      qualifiedCount = enrichResult.qualifiedCount
      hbState.counters.qualified = qualifiedCount

      // 5c. Upsert
      hbState.phase = 'upsert'
      const upsertResult = await upsertProspectsBatch(supabase, scored, pushLog)
      prospectsNew = upsertResult.prospectsNew
      prospectsUpdated = upsertResult.prospectsUpdated
      hbState.counters.prospects_new = prospectsNew
      hbState.counters.prospects_updated = prospectsUpdated

      // 5d. Catégorisation secteur (optionnelle, ne bloque pas le pipeline).
      // Cap strict 20 prospects pour préserver le quota Gemini gratuit lors des
      // sourcings UI répétés. Skip silencieux si GEMINI_API_KEY absente.
      hbState.phase = 'secteur_categorisation'
      await categoriserSecteursPostUpsert(userId, supabase, scored, pushLog)
    }
  } finally {
    // 6. Persiste TOUJOURS l'état partiel (succès ou erreur) — pas de curseur perdu.
    //
    // `persistSourcingState` ne re-throw jamais (log warn en interne via console.log
    // structuré, cf. ligne 350-358). Ce finally est donc safe : il n'écrase pas une
    // erreur en cours de propagation depuis le try.
    if (outcome) {
      await persistSourcingState(userId, supabase, {
        curseur: outcome.curseurFinal,
        curseurSuivant: outcome.curseurFinal,
        filters_signature: filters.signature,
        last_total: outcome.totalAvailable,
        exhausted_at: outcome.exhausted ? new Date().toISOString() : null,
        last_run_at: new Date().toISOString(),
      })
    }
  }

  return { scored, qualifiedCount, outcome, prospectsNew, prospectsUpdated }
  } finally {
    // Cleanup heartbeat dans TOUS les cas (succès, throw, timeout interne).
    stopHeartbeat()
  }
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
    universe_empty: output.outcome.universeEmpty,
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
    prospectsSourced: output.scored.length,
    prospectsQualified: output.qualifiedCount,
    prospectsNew: output.prospectsNew,
    prospectsUpdated: output.prospectsUpdated,
    totalAvailable: output.outcome.totalAvailable,
    pagesLoaded: output.outcome.pagesLoaded,
    exhausted: output.outcome.exhausted,
    universeEmpty: output.outcome.universeEmpty,
    curseurFinal: output.outcome.curseurFinal,
    usedFallback: output.outcome.usedFallback,
    duration_ms,
  }
}
