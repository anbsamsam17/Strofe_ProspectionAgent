// ============================================================
// ORCHESTRATOR — Agent IA Prospection Bilan Carbone
// Chef d'orchestre du run nocturne (Vercel Cron 22h)
//
// Le run nocturne s'arrête après l'upsert des prospects.
// La génération de daily list (sélection top N, pitchs GPT-4o, items)
// a été supprimée — l'UI consomme désormais directement la table
// `prospects` (voir /prospects, /pipeline). Les tables `daily_lists` /
// `daily_list_items` sont conservées en lecture pour l'historique
// d'appels affiché sur /prospects/[id].
// ============================================================

import {
  captureWithContext,
  shouldReportFailure,
} from '@/lib/observability/sentry-helpers'
import type { Database, Json } from '@/lib/supabase/database.types'
import type { SupabaseAdminClient, SupabaseServerClient } from '@/lib/supabase/server'
import type {
  AgentLog,
  AgentRun,
  ProfileSettings,
} from '@/lib/types'
import { checkBlacklistedDomains } from './blacklist-checker'
import { enrichirContact, getCreditsUsed } from './contact-enrichment'
import { isProfessionalEmail } from './email-is-pro'
import { filterOptedOutSirens } from './opt-out-checker'
import {
  categoriserSecteurAvecGemini,
  isGeminiAvailable,
  scoreLeadAvecGemini,
  type GeminiProspectInput,
} from './gemini-scoring'
import { resolveSectorFromNaf } from './naf-labels'
import {
  runPipelineSourcing,
  type AdaptiveSourcingOutcome,
  type PipelineSourcingOutput,
} from './sourcing-runner'

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
  // Protection anti-run concurrent : un seul run `running` par user à la fois.
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
    sourcing_target_per_run: settings.sourcing_target_per_run,
    target_sectors: settings.target_sectors,
    target_city: settings.target_city,
  })

  return settings
}

// ------------------------------------------------------------
// PHASE 3 : SOURCING ADAPTATIF (Wave 2.2 — pagination curseur Sirene)
// ------------------------------------------------------------
//
// Cette phase délègue à `runPipelineSourcing` (lib/agent/sourcing-runner.ts)
// qui fait :
//   1. résolution filtres effectifs + signature
//   2. chargement profiles.sourcing_state + invalidation curseur
//   3. boucle adaptative (fetch page → dedup → continue jusqu'à N candidats)
//   4. enrichissement ADEME (batch 20) + scoring
//   5. upsert prospects (batch 50) + comptage new/updated
//   6. persistance sourcing_state (curseur final, signature, exhausted_at)
//
// Les counters Sirene (total_available, pages_loaded, curseur_final, new/updated)
// sont remontés dans `agent_runs` via updateRunInDB.

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
// PHASE 3.5 : CATÉGORISATION SECTEUR via Gemini Flash 2.0
// ------------------------------------------------------------

/**
 * Nombre maximum de prospects catégorisés par run.
 *
 * Augmenté de 50 → 200 le 2026-05-17 pour rattraper le backlog (~700 prospects
 * existants insérés sans `secteur_libelle` avant cablage Gemini, cf. enrichirProspect
 * dans sourcing.ts qui ne renseigne JAMAIS ce champ). Le free tier Gemini Flash 2.0
 * autorise 1500 req/jour — 200 par run nocturne reste loin du plafond, mais nécessite
 * le throttle interne `SECTEUR_THROTTLE_MS` (50ms) pour respecter la limite 30 req/min.
 */
const SECTEUR_MAX_PER_RUN = 200

/** Parallélisme du batch catégorisation (rate-limit Gemini Flash 30 req/min). */
const SECTEUR_BATCH_PARALLELISM = 5

/**
 * Complète `prospects.secteur_libelle` quand il est NULL, vide, ou littéral
 * "Inconnu*" via Gemini Flash 2.0.
 *
 * Phase NON-FATALE — n'impacte ni le scoring numérique (déjà calculé) ni la suite
 * du pipeline. Si `GEMINI_API_KEY` est absente, la phase est skippée silencieusement.
 *
 * Le filtre inclut désormais `secteur_libelle ILIKE 'inconnu%'` pour rattraper les
 * prospects où la valeur littérale "Inconnu" a été persistée par un import legacy
 * ou un import manuel — équivalent fonctionnel d'un NULL pour l'utilisateur.
 *
 * PII : aucune donnée contact n'est envoyée à Gemini (uniquement code NAF +
 * raison sociale, qui sont publiques via Sirene).
 */
async function phaseSecteurCategorisation(
  run: AgentRun,
  supabase: SupabaseServerClient,
): Promise<void> {
  run.phase = 'secteur_categorisation'

  log(run, 'secteur_categorisation', 'Démarrage catégorisation secteur (cascade NAF puis Gemini)', 'info', {
    cap: SECTEUR_MAX_PER_RUN,
    gemini_available: isGeminiAvailable(),
  })

  // Charger les prospects sans secteur_libelle exploitable : NULL, chaîne vide
  // OU valeur littérale "Inconnu*" (cas import legacy). Sirene NAF doit être
  // présent pour permettre la classification.
  const { data: prospects, error } = await supabase
    .from('prospects')
    .select('id, siren, raison_sociale, secteur_naf, secteur_libelle, effectif_min')
    .eq('user_id', run.user_id)
    .is('archived_at', null)
    .or('secteur_libelle.is.null,secteur_libelle.eq.,secteur_libelle.ilike.inconnu%')
    .not('secteur_naf', 'is', null)
    .order('score_priorite', { ascending: false })
    .limit(SECTEUR_MAX_PER_RUN)

  if (error) {
    log(run, 'secteur_categorisation', 'Lecture prospects à catégoriser impossible', 'warn', {
      error: error.message,
    })
    return
  }

  const selected = prospects?.length ?? 0

  if (!prospects || selected === 0) {
    log(run, 'secteur_categorisation', 'Catégorisation : 0 prospects sélectionnés (rien à catégoriser)', 'info', {
      selected: 0,
      resolus_par_naf: 0,
      categorises_par_gemini: 0,
      echecs: 0,
      cap: SECTEUR_MAX_PER_RUN,
    })
    return
  }

  log(run, 'secteur_categorisation', `Catégorisation : ${selected} prospects sélectionnés`, 'info', {
    selected,
    cap: SECTEUR_MAX_PER_RUN,
  })

  // ---- ÉTAPE 1 — Résolution déterministe via mapping NAF rev. 2 INSEE ----
  // Couvre 99% des cas. Aucun appel réseau, aucun quota consommé.
  let resolusParNaf = 0
  let categorisesParGemini = 0
  let echecsCount = 0
  const prospectsBesoinGemini: typeof prospects = []

  for (const p of prospects) {
    const nafResult = resolveSectorFromNaf((p.secteur_naf as string | null) ?? null)
    if (nafResult) {
      const { error: updateError } = await supabase
        .from('prospects')
        .update({ secteur_libelle: nafResult.libelle })
        .eq('id', p.id as string)
      if (updateError) {
        echecsCount += 1
        log(
          run,
          'secteur_categorisation',
          `Échec UPDATE secteur_libelle (via NAF) prospect ${p.id}`,
          'warn',
          { prospect_id: p.id, error: updateError.message },
        )
      } else {
        resolusParNaf += 1
      }
    } else {
      prospectsBesoinGemini.push(p)
    }
  }

  // ---- ÉTAPE 2 — Fallback Gemini pour les NAF non résolubles ----
  if (prospectsBesoinGemini.length > 0 && isGeminiAvailable()) {
    for (
      let groupStart = 0;
      groupStart < prospectsBesoinGemini.length;
      groupStart += SECTEUR_BATCH_PARALLELISM
    ) {
      const groupEnd = Math.min(groupStart + SECTEUR_BATCH_PARALLELISM, prospectsBesoinGemini.length)
      const group = prospectsBesoinGemini.slice(groupStart, groupEnd)

      const results = await Promise.all(
        group.map(async (p) => {
          const id = p.id as string
          const result = await categoriserSecteurAvecGemini({
            nafCode: (p.secteur_naf as string | null) ?? null,
            raisonSociale: (p.raison_sociale as string | null) ?? '',
            effectifMin: (p.effectif_min as number | null) ?? null,
          })
          return { id, result }
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
          log(
            run,
            'secteur_categorisation',
            `Échec UPDATE secteur_libelle (via Gemini) prospect ${id}`,
            'warn',
            { prospect_id: id, error: updateError.message },
          )
          continue
        }
        categorisesParGemini += 1
      }
    }
  } else if (prospectsBesoinGemini.length > 0) {
    // Gemini indisponible et NAF non résoluble → on log mais on ne plante pas.
    echecsCount += prospectsBesoinGemini.length
  }

  log(
    run,
    'secteur_categorisation',
    `Catégorisation : ${selected} sélectionnés, ${resolusParNaf} via NAF, ${categorisesParGemini} via Gemini, ${echecsCount} échecs`,
    'info',
    {
      selected,
      resolus_par_naf: resolusParNaf,
      categorises_par_gemini: categorisesParGemini,
      echecs: echecsCount,
      cap: SECTEUR_MAX_PER_RUN,
      gemini_available: isGeminiAvailable(),
      source: 'naf-labels + gemini-2.0-flash',
    },
  )
}

// ------------------------------------------------------------
// PHASE 4 : ENRICHISSEMENT CONTACTS (prospects prioritaires)
// ------------------------------------------------------------

/**
 * Enrichissement contacts v2 — stratégie HOT/COLD pour optimiser les quotas
 * free tier (Pappers 100/mois, Hunter 25/mois).
 *
 * - "HOT" = obligation BEGES + non publié OU expiré (cible commerciale chaude)
 *   → ces prospects passent en PRIORITÉ dans la cascade payante (Pappers+Hunter)
 * - "COLD" = autres prospects sans contact complet
 *   → enrichis via sources gratuites illimitées uniquement (côté enrichirContact)
 *
 * Pré-filtres :
 * - Opt-out : les SIREN/emails dans `opt_out` ne sont JAMAIS enrichis (RGPD)
 * - Email is_pro : un email perso (gmail, hotmail…) n'écrase JAMAIS le primary
 *
 * Limites :
 * - Max 150 prospects par run (vs 10 auparavant)
 * - Appels séquentiels (pas de parallélisme) pour préserver les crédits
 * - Phase NON-FATALE : une erreur ici ne bloque pas le pipeline
 */
async function phaseContactEnrichment(
  run: AgentRun,
  supabase: SupabaseServerClient,
): Promise<void> {
  run.phase = 'contact_enrichment'
  log(run, 'contact_enrichment', 'Démarrage enrichissement v2 (HOT first)', 'info')

  // Charger jusqu'à 150 prospects sans contact complet (vs 10 + score>70 avant).
  // On récupère aussi obligation_beges/beges_publie/beges_valide pour computer le tier.
  //
  // Migration 017 : on EXCLUT systématiquement les prospects 'do_not_contact'
  // (opt-out manuel utilisateur — RGPD) ET 'rejected' (tentative non aboutie,
  // pas la peine de consommer des crédits Pappers/Hunter pour les recontacter).
  // L'exclusion 'do_not_contact' est CONTRACTUELLE — ne jamais retirer sans
  // validation produit (cf. .claude/rules/security.md, RGPD opt-out).
  const { data: prospects, error } = await supabase
    .from('prospects')
    .select('id, siren, raison_sociale, contact_email, contact_telephone, contact_nom, contact_prenom, contact_poste, contact_linkedin, obligation_beges, beges_publie, beges_valide, score_priorite')
    .eq('user_id', run.user_id)
    .neq('statut', 'do_not_contact')
    .neq('statut', 'rejected')
    .or('contact_email.is.null,contact_telephone.is.null')
    .order('score_priorite', { ascending: false })
    .limit(150)

  if (error) {
    log(run, 'contact_enrichment', 'Impossible de charger les prospects à enrichir', 'warn', {
      error: error.message,
    })
    return
  }

  if (!prospects || prospects.length === 0) {
    log(run, 'contact_enrichment', 'Aucun prospect à enrichir (tous complets)', 'info')
    return
  }

  // Filtre opt-out : exclure les SIREN refusant la prospection (RGPD).
  const sirensInBatch = prospects.map((p) => p.siren).filter((s): s is string => Boolean(s))
  const allowedSirens = await filterOptedOutSirens(supabase, run.user_id, sirensInBatch)
  const allowedSet = new Set(allowedSirens)
  const optedOutCount = sirensInBatch.length - allowedSirens.length
  const filtered = prospects.filter((p) => p.siren && allowedSet.has(p.siren))

  if (optedOutCount > 0) {
    log(run, 'contact_enrichment', `${optedOutCount} prospects exclus (opt-out)`, 'info')
  }

  // Tri HOT first : obligation_beges=true + (beges_publie=false OU beges_valide=false)
  // arrive en tête pour consommer les quotas Pappers/Hunter en priorité.
  const isHot = (p: { obligation_beges: boolean | null; beges_publie: boolean | null; beges_valide: boolean | null }) =>
    p.obligation_beges === true && (p.beges_publie === false || p.beges_valide === false)

  const sorted = filtered.slice().sort((a, b) => {
    const aH = isHot(a) ? 1 : 0
    const bH = isHot(b) ? 1 : 0
    if (aH !== bH) return bH - aH
    return (b.score_priorite ?? 0) - (a.score_priorite ?? 0)
  })

  const hotCount = sorted.filter(isHot).length
  log(
    run,
    'contact_enrichment',
    `${sorted.length} prospects à enrichir (${hotCount} HOT, ${sorted.length - hotCount} COLD)`,
    'info',
  )

  let enrichis = 0
  let emailsPersoSkippes = 0

  // Appels séquentiels — pas de batch parallèle pour préserver les quotas gratuits
  for (const prospect of sorted) {
    const existingContact = {
      contact_nom:       prospect.contact_nom ?? undefined,
      contact_prenom:    prospect.contact_prenom ?? undefined,
      contact_poste:     prospect.contact_poste ?? undefined,
      contact_telephone: prospect.contact_telephone ?? undefined,
      contact_email:     prospect.contact_email ?? undefined,
      contact_linkedin:  prospect.contact_linkedin ?? undefined,
    }

    // Garde défensive : siren null exclu de l'enrichissement (impossible en pratique
    // post-sourcing mais le type le permet désormais — cf. select avec ProspectRow).
    if (!prospect.siren) continue

    let nouveauxChamps: Partial<typeof existingContact>
    try {
      // Passe le contexte (userId + supabase) pour activer la persistance des quotas
      // via la table `api_quotas` (migration 015). Mode dégradé : si la table n'existe
      // pas encore ou le client échoue, contact-enrichment.ts retombe sur le compteur
      // in-memory _credits (rétrocompat). Cf. lib/agent/quotas.ts.
      nouveauxChamps = await enrichirContact(
        prospect.siren,
        existingContact,
        prospect.raison_sociale ?? '',
        { userId: run.user_id, supabase },
      )
    } catch (err) {
      log(run, 'contact_enrichment', `Erreur enrichissement SIREN ${prospect.siren}`, 'warn', {
        siren: prospect.siren,
        error: err instanceof Error ? err.message : String(err),
      })
      // Anti-spam : capture seulement la 1ère erreur + 1 sur 5 ensuite, par run.
      // Sans throttle, une cascade RE/Pappers/Hunter en panne génère N events Sentry
      // identiques par run (cf. observability bug B 2026-05-12, timeout 300s).
      if (shouldReportFailure('contact-enrichment.cascade', run.id, 5)) {
        captureWithContext(err, {
          pipeline_phase: 'enrichment',
          run_id: run.id,
          user_id: run.user_id,
          extra: { siren: prospect.siren },
        })
      }
      continue
    }

    // Rien de nouveau trouvé → passer au suivant
    if (Object.keys(nouveauxChamps).length === 0) continue

    // Filtre RGPD email_is_pro : un email perso (gmail, hotmail, etc.) ne doit
    // JAMAIS écraser le primary `contact_email` (non envoyable en prospection B2B).
    // On le retire du payload mais on garde le log pour audit.
    if (nouveauxChamps.contact_email && !isProfessionalEmail(nouveauxChamps.contact_email)) {
      log(run, 'contact_enrichment', `Email perso ignoré pour SIREN ${prospect.siren}`, 'info', {
        siren: prospect.siren,
      })
      delete nouveauxChamps.contact_email
      emailsPersoSkippes += 1
      if (Object.keys(nouveauxChamps).length === 0) continue
    }

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
    prospects_analyses: sorted.length,
    prospects_hot: hotCount,
    prospects_cold: sorted.length - hotCount,
    emails_perso_skippes: emailsPersoSkippes,
    opt_out_excluded: optedOutCount,
    credits_pappers: credits.pappers,
    credits_hunter: credits.hunter,
  })
}

// ------------------------------------------------------------
// PHASE 5 : SCORING GEMINI (top N prospects)
// ------------------------------------------------------------

/**
 * Nombre maximum de prospects scorés par Gemini par run.
 * Aligné sur le top utilisé en aval (15 appels/jour côté UI).
 */
const GEMINI_TOP_N = 15

/**
 * Ancienneté au-delà de laquelle un prospect déjà scoré Gemini est re-scoré
 * (jours). Aligne le code sur la docstring de `phaseGeminiScoring` qui promet
 * un re-scoring des prospects scorés il y a plus de 7 jours.
 */
const GEMINI_RESCORE_AFTER_DAYS = 7

/** Borne ISO `now - GEMINI_RESCORE_AFTER_DAYS` pour le filtre de re-scoring. */
function GEMINI_RESCORE_THRESHOLD_ISO(): string {
  return new Date(
    Date.now() - GEMINI_RESCORE_AFTER_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
}

/**
 * Parallélisme du batch Gemini (rate-limit Gemini 2.0 Flash).
 * Le module `gemini-scoring` gère déjà un batch interne, mais on l'appelle ici
 * en séquence par groupes pour granularité du logging et préserver les quotas
 * en cas de cohabitation avec d'autres agents.
 */
const GEMINI_BATCH_PARALLELISM = 5

/**
 * Scoring qualitatif Gemini : pour chaque prospect du top N (par score_priorite),
 * appelle Gemini pour produire un score d'intérêt commercial 0-100 + 3-5 raisons
 * spécifiques. Stocke dans `prospects.gemini_score / gemini_raisons / gemini_generated_at`.
 *
 * Contraintes :
 * - Top N = 15 prospects max par run (cf. DAILY_CALL_TARGET).
 * - Filtre : prospects non encore scorés (`gemini_generated_at IS NULL`) OU
 *   scorés il y a > 7 jours (re-scoring si données enrichies entre-temps).
 * - Échec TRANSITOIRE (timeout / 429 / 5xx) : `gemini_generated_at` reste NULL
 *   (rien n'est persisté) pour que le prospect soit re-tenté au prochain run,
 *   au lieu d'être verrouillé à un score 0 (cf. `transient_failure`).
 * - Phase NON-FATALE : une erreur ici ne bloque pas le pipeline.
 * - Sans `GEMINI_API_KEY` : phase skippée silencieusement.
 * - PII : aucun `contact_email` / `contact_telephone` / `contact_nom` envoyé au prompt.
 */
async function phaseGeminiScoring(
  run: AgentRun,
  supabase: SupabaseServerClient,
): Promise<void> {
  run.phase = 'gemini_scoring'

  if (!isGeminiAvailable()) {
    log(run, 'gemini_scoring', 'GEMINI_API_KEY absente — phase skippée', 'info')
    return
  }

  log(run, 'gemini_scoring', `Démarrage scoring Gemini (top ${GEMINI_TOP_N})`, 'info')

  // Charger le top N par score_priorite, prospects non scorés Gemini en priorité.
  // On filtre les prospects archivés (archived_at NULL) et rejected (priorité 0).
  // Champs sélectionnés volontairement restreints au sous-ensemble GeminiProspectInput
  // + l'id pour l'update. AUCUN champ contact (PII).
  //
  // NOTE typage : `beges_valide` est défini par la migration 004 mais n'apparaît
  // pas encore dans `database.types.ts` (régénération du type encore en dette).
  // On cast en `GeminiProspectsRow[]` après le query — c'est un sur-ensemble
  // du Row généré et la migration 004 est déployée en prod depuis longtemps.
  type GeminiProspectsRow = {
    id: string
    raison_sociale: string | null
    secteur_naf: string | null
    secteur_libelle: string | null
    effectif_min: number | null
    effectif_max: number | null
    ville: string | null
    beges_publie: boolean | null
    beges_valide: boolean | null
    obligation_beges: boolean | null
    signaux: Json | null
  }

  const { data: prospectsRaw, error } = await supabase
    .from('prospects')
    .select(
      'id, raison_sociale, secteur_naf, secteur_libelle, effectif_min, effectif_max, ville, beges_publie, obligation_beges, signaux',
    )
    .eq('user_id', run.user_id)
    .is('archived_at', null)
    .neq('statut', 'rejected')
    // Migration 017 : exclure les opt-out manuels — pas de scoring Gemini sur
    // des prospects qu'on ne contactera jamais (économie de quota + RGPD).
    .neq('statut', 'do_not_contact')
    // Jamais scorés (gemini_generated_at NULL) OU scorés il y a > 7 jours
    // (re-scoring si les données ont été enrichies entre-temps). Tient la
    // promesse de la docstring ci-dessus. Le filtre NULL seul verrouillait à
    // vie les prospects qu'un échec transitoire avait laissés à un score 0
    // (cf. fix transient_failure dans gemini-scoring.ts qui laisse désormais
    // gemini_generated_at NULL sur timeout/429/5xx).
    .or(`gemini_generated_at.is.null,gemini_generated_at.lt.${GEMINI_RESCORE_THRESHOLD_ISO()}`)
    .order('score_priorite', { ascending: false })
    .limit(GEMINI_TOP_N)

  if (error) {
    log(run, 'gemini_scoring', 'Impossible de charger les prospects à scorer Gemini', 'warn', {
      error: error.message,
    })
    return
  }

  if (!prospectsRaw || prospectsRaw.length === 0) {
    log(run, 'gemini_scoring', 'Aucun prospect à scorer Gemini (top N déjà scoré)', 'info')
    return
  }

  // Récupération séparée de `beges_valide` (colonne migration 004 absente du type généré).
  // Map siren->beges_valide via une requête typée différente pour rester strict.
  const prospectIds = prospectsRaw.map((p) => p.id as string)
  const begesValideById = new Map<string, boolean | null>()
  if (prospectIds.length > 0) {
    // Cast sûr : la colonne `beges_valide` existe en DB (migration 004 déployée)
    // mais pas dans les types générés. On query via un client retyé localement.
    const begesValideQuery = await (
      supabase.from('prospects') as unknown as {
        select: (cols: string) => {
          in: (
            col: string,
            ids: string[],
          ) => Promise<{
            data: Array<{ id: string; beges_valide: boolean | null }> | null
            error: { message: string } | null
          }>
        }
      }
    )
      .select('id, beges_valide')
      .in('id', prospectIds)

    if (begesValideQuery.error) {
      log(run, 'gemini_scoring', 'Lecture beges_valide impossible — fallback undefined', 'warn', {
        error: begesValideQuery.error.message,
      })
    } else {
      for (const row of begesValideQuery.data ?? []) {
        begesValideById.set(row.id, row.beges_valide)
      }
    }
  }

  // Cast sûr : on étend la projection avec `beges_valide` (joint depuis begesValideById)
  // dans le mapping ci-dessous, sans toucher au type retourné par le SELECT principal.
  const prospects = prospectsRaw as unknown as GeminiProspectsRow[]

  let scoredCount = 0
  let failedCount = 0

  // Batch en groupes parallèles. scoreLeadAvecGemini ne throw pas (fallback intégré).
  for (let groupStart = 0; groupStart < prospects.length; groupStart += GEMINI_BATCH_PARALLELISM) {
    const groupEnd = Math.min(groupStart + GEMINI_BATCH_PARALLELISM, prospects.length)
    const group = prospects.slice(groupStart, groupEnd)

    const results = await Promise.all(
      group.map(async (p) => {
        const begesValide = begesValideById.get(p.id) ?? undefined
        const input: GeminiProspectInput = {
          raison_sociale: p.raison_sociale ?? '',
          secteur_naf: p.secteur_naf ?? undefined,
          secteur_libelle: p.secteur_libelle ?? undefined,
          effectif_min: p.effectif_min ?? undefined,
          effectif_max: p.effectif_max ?? undefined,
          beges_publie: Boolean(p.beges_publie),
          beges_valide: begesValide ?? undefined,
          obligation_beges: Boolean(p.obligation_beges),
          ville: p.ville ?? undefined,
          signaux: (p.signaux as unknown as GeminiProspectInput['signaux']) ?? [],
        }
        const result = await scoreLeadAvecGemini(input)
        return { id: p.id, result }
      }),
    )

    for (const { id, result } of results) {
      // Échec TRANSITOIRE (timeout / 429 / 5xx) : on NE persiste PAS
      // gemini_generated_at (on laisse la colonne intacte / NULL) pour que le
      // prospect soit re-tenté au prochain run, au lieu d'être verrouillé à un
      // score 0. On skippe donc l'update entièrement (rien d'exploitable à
      // écrire), et on le compte comme échec.
      if (result.transient_failure) {
        failedCount += 1
        log(run, 'gemini_scoring', `Scoring Gemini transitoire échoué — retry au prochain run (prospect ${id})`, 'warn', {
          prospect_id: id,
        })
        continue
      }

      const updatePayload = {
        gemini_score: result.interet_score,
        gemini_raisons: result.raisons as unknown as Json,
        gemini_generated_at: result.generated_at,
      }

      const { error: updateError } = await supabase
        .from('prospects')
        .update(updatePayload)
        .eq('id', id)

      if (updateError) {
        failedCount += 1
        log(run, 'gemini_scoring', `Échec persistance score Gemini pour prospect ${id}`, 'warn', {
          prospect_id: id,
          error: updateError.message,
        })
        continue
      }
      scoredCount += 1
    }
  }

  log(run, 'gemini_scoring', `${scoredCount} prospects scorés Gemini`, 'info', {
    prospects_scored: scoredCount,
    prospects_failed: failedCount,
    prospects_analyzed: prospects.length,
  })
}

// ------------------------------------------------------------
// ORCHESTRATEUR PRINCIPAL
// ------------------------------------------------------------

/**
 * Point d'entrée du run nocturne de l'agent.
 * Coordonne toutes les phases dans l'ordre, avec gestion d'erreur par phase.
 *
 * Le run s'arrête après l'upsert des prospects (effectué dans `runPipelineSourcing`).
 * Aucune daily_list n'est générée ici — l'UI lit directement `prospects`.
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
  // PHASE 3 : SOURCING ADAPTATIF + ENRICHISSEMENT ADEME + SCORING + UPSERT
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
    captureWithContext(err, {
      pipeline_phase: 'sourcing',
      run_id: run.id,
      user_id: run.user_id,
      extra: { fatal: true, phase: 'sourcing_adaptive' },
    })
    run.status = 'failed'
    run.error_message = `Sourcing: ${err instanceof Error ? err.message : String(err)}`
    run.completed_at = new Date().toISOString()
    await updateRunInDB(run, supabaseAdmin)
    return run
  }

  // --------------------------------------------------------
  // PHASE 3.5 : CATÉGORISATION SECTEUR (Gemini Flash 2.0)
  // Phase NON-FATALE — complète `prospects.secteur_libelle` quand vide.
  // Skippe silencieusement si GEMINI_API_KEY absente.
  // PII : aucune donnée contact envoyée à Gemini.
  // --------------------------------------------------------
  try {
    await phaseSecteurCategorisation(run, supabaseAdmin)
    await updateRunInDB(run, supabaseAdmin)
  } catch (err) {
    log(run, 'secteur_categorisation', 'Catégorisation secteur échouée — pipeline non bloqué', 'warn', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // --------------------------------------------------------
  // PHASE 4 : ENRICHISSEMENT CONTACTS (prospects prioritaires)
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
  // PHASE 4.25 : BLACKLIST DOMAINES (GLN-061)
  // Phase NON-FATALE — post-enrichment, on bascule en `do_not_contact`
  // les prospects dont le contact_email matche un domaine blacklisté par
  // l'utilisateur (clients existants, concurrents).
  // Skippe silencieusement si migration 021 absente.
  // --------------------------------------------------------
  try {
    run.phase = 'blacklist_check'
    const blacklistResult = await checkBlacklistedDomains(run.user_id, supabaseAdmin)
    if (blacklistResult.skipped) {
      log(run, 'blacklist_check', 'Blacklist domaines skippée', 'info', {
        reason: blacklistResult.skipReason,
      })
    } else {
      log(
        run,
        'blacklist_check',
        `${blacklistResult.matched} prospect(s) basculé(s) en do_not_contact via blacklist domaine`,
        'info',
        {
          matched: blacklistResult.matched,
          domains: Array.from(
            new Set(blacklistResult.matches.map((m) => m.matched_domain)),
          ),
        },
      )
    }
    await updateRunInDB(run, supabaseAdmin)
  } catch (err) {
    log(run, 'blacklist_check', 'Blacklist domaines échoué — pipeline non bloqué', 'warn', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // --------------------------------------------------------
  // PHASE 4.5 : SCORING GEMINI (intérêt commercial + raisons)
  // Phase NON-FATALE — une erreur ici ne bloque pas le pipeline.
  // Skippe silencieusement si GEMINI_API_KEY absente (cf. gemini-scoring.ts).
  // Génère gemini_score (0-100) + gemini_raisons (3-5 args commerciaux) pour
  // chaque prospect du top (limité par phaseGeminiScoring).
  // --------------------------------------------------------
  try {
    await phaseGeminiScoring(run, supabaseAdmin)
    await updateRunInDB(run, supabaseAdmin)
  } catch (err) {
    log(run, 'gemini_scoring', 'Scoring Gemini échoué — pipeline non bloqué', 'warn', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // --------------------------------------------------------
  // PHASE 5 : FINALISATION
  // --------------------------------------------------------
  run.phase = 'completed'
  run.status = 'completed'
  run.completed_at = new Date().toISOString()
  // list_generated reste `false` — la daily list n'est plus générée par l'orchestrator.
  run.list_generated = false

  log(run, 'completed', 'Run nocturne terminé avec succès', 'info', {
    prospects_sourced: run.prospects_sourced,
    prospects_qualified: run.prospects_qualified,
    duration_ms:
      new Date(run.completed_at).getTime() - new Date(run.started_at).getTime(),
  })

  await updateRunInDB(run, supabaseAdmin)

  return run
}
