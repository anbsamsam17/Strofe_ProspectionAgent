// =============================================================================
// scripts/import-sirene-bulk.ts
//
// ETL bulk SIRENE INSEE → table publique `sirene_cache` Supabase.
// Sert de fondation au fallback "sourcing offline" (l'API Sirene live étant
// instable). Voir docs/sirene-bulk-import.md pour le contexte produit.
//
// Pipeline :
//   1. GET https://files.data.gouv.fr/insee-sirene/StockEtablissement_utf8.zip
//      (~700 MB compressé, ~3 GB décompressé, ~30M lignes) en stream vers /tmp,
//      avec retry exponentiel x3 sur 5xx/timeout.
//   2. unzipper en flux (le ZIP contient un unique .csv).
//   3. csv-parse en flux ligne par ligne.
//   4. Filtre BEGES strict (early-skip) :
//        - etatAdministratifEtablissement === 'A' (actif)
//        - etablissementSiege === 'true' (siège uniquement)
//        - trancheEffectifsEtablissement IN ['21','22','31','32','41','42','51','52','53']
//          (>= 10 salariés, cohérent avec la cible BEGES 250+ tout en gardant
//          de la marge pour les filtres user en aval)
//        - section NAF dérivée IN ['A','C','D','E','F','H']
//          (Agriculture / Industrie / Énergie / Eau-déchets / Construction / Transport)
//   5. Upsert par batch de 500 dans `sirene_cache` (service_role).
//      onConflict 'siren' → idempotent, rejouable sans corrompre la DB.
//   6. Garde-fou storage : toutes les 10 000 lignes, query `sirene_cache_size`,
//      ABORT si > MAX_STORAGE_MB (défaut 100 MB) pour rester sous Free tier 500 MB.
//   7. Logs structurés JSON : progression toutes les 10 000 lignes + résumé final.
//
// Conventions du projet :
//   - TypeScript strict (cf. rules/code-style.md)
//   - Service role uniquement côté serveur (cf. rules/security.md)
//   - Whitelist SSRF respectée : on tape data.gouv.fr et le projet Supabase
//   - Pas de PII logguée (le bulk SIRENE ne contient pas de PII pour les
//     personnes morales — notre filtre tranche >= 21 exclut les EI/freelances).
//
// Dépendances runtime (présentes en devDependencies depuis le POC) :
//   - csv-parse
//   - unzipper, @types/unzipper
//   - tsx ou node --experimental-strip-types (Node 22.6+)
//
// Exécution locale (Node 22.6+ requis pour --experimental-strip-types) :
//   npm run import-sirene
//
// Compatibilité Vercel cron : à éviter (cap 800s sur Pro, ETL dure 15-30 min).
// Plan d'évolution : job externe (Render cron, GitHub Actions schedule).
// =============================================================================

import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parse as csvParse } from 'csv-parse'
import unzipper from 'unzipper'

// ---------------------------------------------------------------------------
// CONFIG — variables d'environnement + constantes
// ---------------------------------------------------------------------------

// INSEE publie plusieurs ressources sous le même dataset data.gouv.fr :
//   - StockEtablissement_utf8 (~1.1 GB ZIP, ~41M établissements) ← celle dont on a besoin
//   - StockUniteLegale_utf8
//   - StockEtablissementHistorique_utf8
//   - StockUniteLegaleHistorique_utf8 (~69M lignes, schéma DIFFÉRENT, pas d'etablissementSiege)
// Les resource IDs changent à chaque republication mensuelle, donc on RÉSOUT
// dynamiquement via l'API métadonnée (sauf override explicite via env).
const SIRENE_DATASET_SLUG =
  'base-sirene-des-entreprises-et-de-leurs-etablissements-siren-siret'
const SIRENE_DATASET_META_URL =
  `https://www.data.gouv.fr/api/1/datasets/${SIRENE_DATASET_SLUG}/`

// Nom de fichier attendu après unzip (garde-fou contre les mauvaises resources).
const EXPECTED_CSV_PREFIX = 'StockEtablissement_utf8'

const SIRENE_DOWNLOAD_URL_OVERRIDE = process.env.SIRENE_DOWNLOAD_URL ?? null

const MAX_STORAGE_MB = parseInt(process.env.MAX_STORAGE_MB ?? '100', 10)
const BATCH_SIZE = parseInt(process.env.SIRENE_BATCH_SIZE ?? '500', 10)

// Seuil de tolérance d'échec partiel : si plus de MAX_ROWS_FAILED lignes ont
// échoué à l'upsert, l'ETL sort en code non-zero (échec partiel = alerte CI/cron).
// 0 = strict (toute ligne perdue fait échouer le job).
const MAX_ROWS_FAILED = parseInt(process.env.SIRENE_MAX_ROWS_FAILED ?? '0', 10)

const LOG_EVERY_ROWS = 10_000
const STORAGE_CHECK_EVERY_ROWS = 10_000

// Mode diagnostic : on parse les N premières lignes, on log les colonnes
// réelles + un échantillon + les compteurs de rejet par cause, puis on sort.
// Pas d'upsert, pas de check storage.
const DRY_RUN = process.env.SIRENE_DRYRUN === '1'
const DRY_RUN_LIMIT = parseInt(process.env.SIRENE_DRYRUN_LIMIT ?? '2000', 10)

const DOWNLOAD_MAX_RETRIES = 3
const DOWNLOAD_INITIAL_BACKOFF_MS = 2_000

// Tranches d'effectifs INSEE retenues : >= 10 salariés.
// Code INSEE → intervalle :
//   '21' = 10-19,   '22' = 20-49 (DEPRECATED — INSEE codifie autrement,
//   '22' = 20-49 selon la nomenclature 2008 actualisée)
// En pratique on s'aligne sur le spec :
//   '21' (10-19), '22' (20-49), '31' (50-99), '32' (100-199),
//   '41' (200-249), '42' (250-499), '51' (500-999), '52' (1000-1999),
//   '53' (2000-4999), ...
const KEPT_TRANCHES = new Set([
  '21', '22', '31', '32', '41', '42', '51', '52', '53',
])

// Bornes effectifs par tranche (INSEE nomenclature 2008).
const TRANCHE_RANGES: Record<string, { min: number; max: number }> = {
  '21': { min: 10, max: 19 },
  '22': { min: 20, max: 49 },
  '31': { min: 50, max: 99 },
  '32': { min: 100, max: 199 },
  '41': { min: 200, max: 249 },
  '42': { min: 250, max: 499 },
  '51': { min: 500, max: 999 },
  '52': { min: 1000, max: 1999 },
  '53': { min: 2000, max: 4999 },
}

// Sections NAF prioritaires pour le BEGES (forte intensité carbone).
const KEPT_NAF_SECTIONS = new Set(['A', 'C', 'D', 'E', 'F', 'H'])

// ---------------------------------------------------------------------------
// LOGGING STRUCTURÉ (conforme aux conventions de l'orchestrator)
// ---------------------------------------------------------------------------

type LogLevel = 'info' | 'warn' | 'error'

function log(level: LogLevel, phase: string, msg: string, meta?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    phase,
    msg,
    ...(meta ? { meta } : {}),
  }
  console.log(JSON.stringify(entry))
}

// ---------------------------------------------------------------------------
// HELPER — section NAF à partir du code activité
// ---------------------------------------------------------------------------

/**
 * Dérive la section NAF (lettre A-U) à partir du code activité principal.
 * Le code INSEE peut arriver au format "0121Z" ou "01.21Z" — on prend les
 * 2 premiers chiffres comme division.
 *
 * Sections retenues pour le BEGES prioritaire (forte intensité carbone) :
 *   A (01-03) Agriculture
 *   C (10-33) Industrie manufacturière
 *   D (35)    Production / distribution d'énergie
 *   E (36-39) Eau, déchets, dépollution
 *   F (41-43) Construction
 *   H (49-53) Transport / entreposage
 *
 * Sections retournées mais hors scope BEGES prioritaire :
 *   B (05-09) Industries extractives
 *
 * Retourne null pour tout code non parseable ou hors sections référencées.
 */
function sectionFromNaf(naf: string | null | undefined): string | null {
  if (!naf) return null
  const div = parseInt(naf.slice(0, 2), 10)
  if (isNaN(div)) return null
  if (div >= 1 && div <= 3) return 'A'
  if (div >= 5 && div <= 9) return 'B'
  if (div >= 10 && div <= 33) return 'C'
  if (div === 35) return 'D'
  if (div >= 36 && div <= 39) return 'E'
  if (div >= 41 && div <= 43) return 'F'
  if (div >= 49 && div <= 53) return 'H'
  return null
}

// ---------------------------------------------------------------------------
// TYPES — colonnes brutes du CSV INSEE retenues
// ---------------------------------------------------------------------------

interface SireneCsvRow {
  siren: string
  siret: string
  denominationUniteLegale?: string
  denominationUsuelle1UniteLegale?: string
  nomUniteLegale?: string
  prenom1UniteLegale?: string
  activitePrincipaleEtablissement?: string
  trancheEffectifsEtablissement?: string
  codePostalEtablissement?: string
  libelleCommuneEtablissement?: string
  numeroVoieEtablissement?: string
  typeVoieEtablissement?: string
  libelleVoieEtablissement?: string
  adresseEtablissement?: string
  etatAdministratifEtablissement?: string
  dateCreationEtablissement?: string
  dateDernierTraitementEtablissement?: string
  etablissementSiege?: string // 'true' / 'false'
}

interface SireneCacheRow {
  siren: string
  siret: string
  raison_sociale: string | null
  activite_principale: string | null
  tranche_effectifs: string | null
  effectif_min: number | null
  effectif_max: number | null
  code_postal: string | null
  commune: string | null
  adresse: string | null
  etat_administratif: string | null
  date_creation: string | null
  date_maj_insee: string | null
  source_file: string
}

// ---------------------------------------------------------------------------
// MAPPING CSV → ROW DB
// ---------------------------------------------------------------------------

function normalizeNaf(raw: string | undefined): string | null {
  // INSEE renvoie "0121Z" ou "01.21Z" selon les sources. On force le point.
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.includes('.')) return trimmed
  if (trimmed.length >= 5) return `${trimmed.slice(0, 2)}.${trimmed.slice(2)}`
  return trimmed
}

function buildAddress(row: SireneCsvRow): string | null {
  const composed = [
    row.numeroVoieEtablissement,
    row.typeVoieEtablissement,
    row.libelleVoieEtablissement,
  ]
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(' ')
  if (composed) return composed
  // Certains exports INSEE fournissent une colonne `adresseEtablissement` consolidée.
  return row.adresseEtablissement?.trim() || null
}

function buildRaisonSociale(row: SireneCsvRow): string | null {
  return (
    row.denominationUniteLegale?.trim() ||
    row.denominationUsuelle1UniteLegale?.trim() ||
    [row.prenom1UniteLegale, row.nomUniteLegale]
      .filter((p): p is string => Boolean(p && p.trim()))
      .join(' ')
      .trim() ||
    null
  )
}

// Compteurs de rejet par cause (mis à jour par mapRow, lus par main pour log final).
const rejectionCounts = {
  etat: 0,
  siege: 0,
  tranche_missing: 0,
  tranche_excluded: 0,
  naf_missing: 0,
  naf_excluded: 0,
  siren_missing: 0,
  siret_missing: 0,
  siren_format: 0,
  siret_format: 0,
}

function mapRow(row: SireneCsvRow, sourceFile: string): SireneCacheRow | null {
  // ---- Filtre BEGES strict (early-skip) ----
  if (row.etatAdministratifEtablissement !== 'A') {
    rejectionCounts.etat++
    return null
  }
  if (row.etablissementSiege !== 'true') {
    rejectionCounts.siege++
    return null
  }

  const tranche = row.trancheEffectifsEtablissement?.trim()
  if (!tranche) {
    rejectionCounts.tranche_missing++
    return null
  }
  if (!KEPT_TRANCHES.has(tranche)) {
    rejectionCounts.tranche_excluded++
    return null
  }

  const naf = normalizeNaf(row.activitePrincipaleEtablissement)
  const section = sectionFromNaf(naf)
  if (!section) {
    rejectionCounts.naf_missing++
    return null
  }
  if (!KEPT_NAF_SECTIONS.has(section)) {
    rejectionCounts.naf_excluded++
    return null
  }

  const siren = row.siren?.trim()
  const siret = row.siret?.trim()
  if (!siren) {
    rejectionCounts.siren_missing++
    return null
  }
  if (!siret) {
    rejectionCounts.siret_missing++
    return null
  }
  // Validation format : SIREN = 9 chiffres, SIRET = 14 chiffres.
  if (!/^\d{9}$/.test(siren)) {
    rejectionCounts.siren_format++
    return null
  }
  if (!/^\d{14}$/.test(siret)) {
    rejectionCounts.siret_format++
    return null
  }

  const range = TRANCHE_RANGES[tranche]

  return {
    siren,
    siret,
    raison_sociale: buildRaisonSociale(row),
    activite_principale: naf,
    tranche_effectifs: tranche,
    effectif_min: range?.min ?? null,
    effectif_max: range?.max ?? null,
    code_postal: row.codePostalEtablissement?.trim() || null,
    commune: row.libelleCommuneEtablissement?.trim() || null,
    adresse: buildAddress(row),
    etat_administratif: 'A',
    date_creation: row.dateCreationEtablissement?.trim() || null,
    date_maj_insee: row.dateDernierTraitementEtablissement?.trim() || null,
    source_file: sourceFile,
  }
}

// ---------------------------------------------------------------------------
// SUPABASE — upsert batched + garde-fou storage
// ---------------------------------------------------------------------------

interface FlushResult {
  upserted: number
  failed: number
}

async function flushBatch(supabase: SupabaseClient, batch: SireneCacheRow[]): Promise<FlushResult> {
  if (batch.length === 0) return { upserted: 0, failed: 0 }
  const { error } = await supabase
    .from('sirene_cache')
    .upsert(batch, { onConflict: 'siren', ignoreDuplicates: false })
  if (error) {
    log('error', 'upsert', 'Erreur upsert batch', {
      batch_size: batch.length,
      first_siren: batch[0]?.siren,
      message: error.message,
    })
    // On ne lève pas : on continue l'ETL (rejouable, idempotent), mais on
    // remonte l'échec à l'appelant pour qu'il soit compté et signalé.
    return { upserted: 0, failed: batch.length }
  }
  return { upserted: batch.length, failed: 0 }
}

interface StorageStat {
  total_bytes: number
  total_mb: number
}

async function getStorageStat(supabase: SupabaseClient): Promise<StorageStat | null> {
  // Migration 019 expose la vue sirene_cache_size avec : total_size (pretty),
  // total_bytes (numeric), active_count, last_import_at, days_since_import.
  // total_mb est calculé côté script (total_bytes / 1024 / 1024).
  const { data, error } = await supabase
    .from('sirene_cache_size')
    .select('total_bytes')
    .limit(1)
    .maybeSingle()

  if (error) {
    log('warn', 'storage_check', 'Impossible de lire sirene_cache_size', {
      message: error.message,
    })
    return null
  }
  if (!data) return null

  // Coercition explicite (la vue Postgres peut typer total_bytes en string côté JS).
  const totalBytes = typeof data.total_bytes === 'string'
    ? parseInt(data.total_bytes, 10)
    : Number(data.total_bytes)

  if (isNaN(totalBytes)) return null
  const totalMb = totalBytes / (1024 * 1024)
  return { total_bytes: totalBytes, total_mb: totalMb }
}

class StorageLimitReachedError extends Error {
  readonly currentMb: number
  readonly limitMb: number
  constructor(currentMb: number, limitMb: number) {
    // Note: pas de "parameter property" (public readonly x: type) car Node
    // --experimental-strip-types ne supporte que les annotations type pures,
    // pas la syntaxe TS qui génère du code (parameter properties, enums, etc.).
    super(
      `Garde-fou storage : sirene_cache atteint ${currentMb.toFixed(2)} MB, limite ${limitMb} MB`,
    )
    this.name = 'StorageLimitReachedError'
    this.currentMb = currentMb
    this.limitMb = limitMb
  }
}

// ---------------------------------------------------------------------------
// DOWNLOAD — stream-fetch vers /tmp avec retry exponentiel
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Résout dynamiquement l'URL de la ressource `StockEtablissement_utf8` via
 * l'API métadonnée data.gouv.fr. Les resource IDs changent à chaque
 * republication mensuelle INSEE — un ID en dur finit toujours par pointer
 * sur le mauvais fichier (cf. bug 2026-05-17 où `0835cd60-...` est devenu
 * `StockUniteLegaleHistorique_utf8`).
 */
async function resolveStockEtablissementUrl(): Promise<string> {
  log('info', 'resolve', 'Résolution dynamique de la resource StockEtablissement', {
    meta_url: SIRENE_DATASET_META_URL,
  })

  const res = await fetch(SIRENE_DATASET_META_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'prospection-agent/etl-sirene-bulk',
    },
  })
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} sur API métadonnée data.gouv.fr — résolution impossible`,
    )
  }

  const meta = (await res.json()) as {
    resources?: Array<{ title?: string; url?: string; id?: string }>
  }
  const resources = meta.resources ?? []

  // On veut la ressource CSV (zip) StockEtablissement, hors variantes
  // historique / liens / doublons / parquet / UniteLegale.
  // Titres réels data.gouv.fr (2026-05) :
  //   "Sirene : Fichier StockEtablissement du 01 Mai 2026"           ← CIBLE
  //   "Sirene : Fichier StockEtablissement du 01 Mai 2026 (format parquet)"
  //   "Sirene : Fichier StockEtablissementHistorique du 01 Mai 2026"
  //   "Sirene : Fichier StockEtablissementLiensSuccession du 01 Mai 2026"
  //   "Sirene : Fichier StockUniteLegale du 01 Mai 2026"
  //   "Sirene : Fichier StockDoublons du 01 Mai 2026"
  const EXCLUDED_TITLE_TOKENS = [
    'Historique',
    'LiensSuccession',
    'Doublons',
    'UniteLegale',
    'parquet',
    '.pdf',
    '.csv', // les "liste-csv-des-variables-..." sont des docs, pas le ZIP
  ]
  const match = resources.find((r) => {
    const t = r.title ?? ''
    if (!t.includes('StockEtablissement')) return false
    if (EXCLUDED_TITLE_TOKENS.some((tok) => t.includes(tok))) return false
    return !!r.url
  })

  if (!match?.url) {
    throw new Error(
      `Resource ${EXPECTED_CSV_PREFIX} introuvable dans le dataset ${SIRENE_DATASET_SLUG}. ` +
        `Ressources disponibles : ${resources.map((r) => r.title).join(', ')}`,
    )
  }

  log('info', 'resolve', 'Resource résolue', {
    title: match.title,
    id: match.id,
    url: match.url,
  })
  return match.url
}

async function downloadToTmp(url: string): Promise<string> {
  log('info', 'download', 'Téléchargement bulk SIRENE', {
    url,
    max_retries: DOWNLOAD_MAX_RETRIES,
  })

  let lastError: unknown = null

  for (let attempt = 1; attempt <= DOWNLOAD_MAX_RETRIES; attempt++) {
    const tmpPath = join(tmpdir(), `sirene-${Date.now()}-${attempt}.zip`)
    try {
      const res = await fetch(url, {
        // Pas d'AbortSignal.timeout : un ZIP de 700 MB sur un réseau correct
        // prend 2-10 min, on laisse le stream se faire son travail.
        headers: {
          Accept: 'application/zip',
          'User-Agent': 'prospection-agent/etl-sirene-bulk',
        },
      })

      if (!res.ok || !res.body) {
        // 5xx → on retry. 4xx → on abandonne immédiatement (auth/URL).
        if (res.status >= 500) {
          throw new Error(`HTTP ${res.status} (5xx, retryable)`)
        }
        throw new Error(`HTTP ${res.status} sur ${url} (non-retryable)`)
      }

      const nodeStream = Readable.fromWeb(
        res.body as Parameters<typeof Readable.fromWeb>[0],
      )
      await pipeline(nodeStream, createWriteStream(tmpPath))
      log('info', 'download', 'Téléchargement terminé', {
        tmp_path: tmpPath,
        attempt,
      })
      return tmpPath
    } catch (err) {
      lastError = err
      const message = err instanceof Error ? err.message : String(err)
      const nonRetryable = message.includes('non-retryable')
      log('warn', 'download', `Échec téléchargement (tentative ${attempt}/${DOWNLOAD_MAX_RETRIES})`, {
        message,
        non_retryable: nonRetryable,
      })
      // Cleanup best-effort du fichier partiel.
      try {
        await unlink(tmpPath)
      } catch {
        /* file may not exist yet */
      }
      if (nonRetryable) break
      if (attempt < DOWNLOAD_MAX_RETRIES) {
        const backoff = DOWNLOAD_INITIAL_BACKOFF_MS * 2 ** (attempt - 1)
        log('info', 'download', `Backoff avant retry`, { backoff_ms: backoff })
        await sleep(backoff)
      }
    }
  }

  throw new Error(
    `Téléchargement bulk SIRENE échoué après ${DOWNLOAD_MAX_RETRIES} tentatives : ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  )
}

// ---------------------------------------------------------------------------
// UNZIP + PARSE + UPSERT — flux complet
// ---------------------------------------------------------------------------

interface ProcessStats {
  processed: number
  filtered_out: number
  kept: number
  upserted: number
  batches_failed: number
  rows_failed: number
  final_size_mb: number | null
}

async function processZip(
  zipPath: string,
  sourceFile: string,
  supabase: SupabaseClient,
): Promise<ProcessStats> {
  let processed = 0
  let kept = 0
  let upserted = 0
  let batchesFailed = 0
  let rowsFailed = 0
  let batch: SireneCacheRow[] = []
  let lastSizeMb: number | null = null

  const directory = await unzipper.Open.file(zipPath)
  const csvEntry = directory.files.find((f) => f.path.endsWith('.csv'))
  if (!csvEntry) {
    throw new Error('Aucun .csv trouvé dans le ZIP SIRENE')
  }
  // Garde-fou : si on a téléchargé la mauvaise resource (ex. UniteLegale,
  // Historique, etc.), les colonnes ne matcheront pas et on rejetterait 100%.
  // On échoue tôt avec un message clair plutôt qu'après 30 min de parsing.
  if (!csvEntry.path.startsWith(EXPECTED_CSV_PREFIX)) {
    throw new Error(
      `Mauvais CSV téléchargé : "${csvEntry.path}" (attendu "${EXPECTED_CSV_PREFIX}*"). ` +
        `Si SIRENE_DOWNLOAD_URL est défini, vérifie qu'il pointe sur StockEtablissement_utf8.zip.`,
    )
  }
  log('info', 'parse', 'Entrée CSV trouvée dans le ZIP', { csv: csvEntry.path })

  const csvStream = csvEntry.stream()
  const parser = csvParse({
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    delimiter: ',',
  })

  csvStream.pipe(parser)

  // Échantillon de lignes brutes pour diagnostic (premières lignes).
  const rawSamples: Array<Record<string, unknown>> = []
  let headersLogged = false

  for await (const rawRow of parser) {
    processed++

    // DIAGNOSTIC : log les colonnes réelles du CSV (1ère ligne uniquement).
    if (!headersLogged) {
      headersLogged = true
      log('info', 'parse', 'Colonnes CSV détectées', {
        column_count: Object.keys(rawRow as object).length,
        columns: Object.keys(rawRow as object),
      })
    }

    // DIAGNOSTIC : échantillon des 5 premières lignes (raw).
    if (DRY_RUN && rawSamples.length < 5) {
      rawSamples.push(rawRow as Record<string, unknown>)
    }

    const mapped = mapRow(rawRow as SireneCsvRow, sourceFile)
    if (mapped) {
      kept++
      batch.push(mapped)
      if (!DRY_RUN && batch.length >= BATCH_SIZE) {
        const res = await flushBatch(supabase, batch)
        upserted += res.upserted
        if (res.failed > 0) {
          batchesFailed++
          rowsFailed += res.failed
        }
        batch = []
      }
    }

    // En mode dry-run, on s'arrête après DRY_RUN_LIMIT lignes parsées
    // (le download du ZIP a déjà eu lieu — on ne paie que le parse).
    if (DRY_RUN && processed >= DRY_RUN_LIMIT) {
      log('info', 'dryrun', 'DRY-RUN — limite atteinte, diagnostic complet', {
        processed,
        kept,
        rejection_counts: rejectionCounts,
        // Sur les 5 lignes raw : on extrait les champs critiques pour
        // confirmer/infirmer le nommage et les valeurs.
        samples_critical_fields: rawSamples.map((r) => ({
          siren: r.siren,
          siret: r.siret,
          etat: r.etatAdministratifEtablissement,
          siege: r.etablissementSiege,
          tranche: r.trancheEffectifsEtablissement,
          naf: r.activitePrincipaleEtablissement,
        })),
        first_sample_full: rawSamples[0] ?? null,
      })
      // Sortie propre via return — main loggera "done" avec les stats.
      return {
        processed,
        filtered_out: processed - kept,
        kept,
        upserted: 0,
        batches_failed: 0,
        rows_failed: 0,
        final_size_mb: null,
      }
    }

    // Logs de progression
    if (processed % LOG_EVERY_ROWS === 0) {
      log('info', 'parse', 'Progression ETL', {
        processed,
        filtered_out: processed - kept,
        upserted,
        current_size_mb: lastSizeMb,
      })
    }

    // Garde-fou storage : on ne check pas trop souvent pour ne pas peser sur l'ETL.
    // Skip en dry-run (pas d'upsert → pas de croissance à surveiller).
    if (!DRY_RUN && processed % STORAGE_CHECK_EVERY_ROWS === 0) {
      // On flush avant de mesurer pour avoir une taille à jour.
      if (batch.length > 0) {
        const res = await flushBatch(supabase, batch)
        upserted += res.upserted
        if (res.failed > 0) {
          batchesFailed++
          rowsFailed += res.failed
        }
        batch = []
      }
      const stat = await getStorageStat(supabase)
      if (stat) {
        lastSizeMb = stat.total_mb
        if (stat.total_mb > MAX_STORAGE_MB) {
          log('warn', 'storage_check', 'ABORT : limite storage atteinte', {
            current_mb: stat.total_mb,
            limit_mb: MAX_STORAGE_MB,
            processed,
            upserted,
          })
          throw new StorageLimitReachedError(stat.total_mb, MAX_STORAGE_MB)
        }
      }
    }
  }

  // Flush final
  if (batch.length > 0) {
    const res = await flushBatch(supabase, batch)
    upserted += res.upserted
    if (res.failed > 0) {
      batchesFailed++
      rowsFailed += res.failed
    }
  }

  // Mesure finale
  const finalStat = await getStorageStat(supabase)

  return {
    processed,
    filtered_out: processed - kept,
    kept,
    upserted,
    batches_failed: batchesFailed,
    rows_failed: rowsFailed,
    final_size_mb: finalStat?.total_mb ?? lastSizeMb,
  }
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

function buildSourceFile(): string {
  // Convention : StockEtablissement_utf8_YYYYMM.zip — trace la fraîcheur.
  const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '')
  return `StockEtablissement_utf8_${yyyymm}.zip`
}

async function main() {
  const startedAt = Date.now()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRole) {
    log('error', 'init', 'Env manquantes', {
      missing: [
        !url ? 'NEXT_PUBLIC_SUPABASE_URL' : null,
        !serviceRole ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
      ].filter(Boolean),
    })
    process.exit(1)
  }

  if (isNaN(MAX_STORAGE_MB) || MAX_STORAGE_MB <= 0) {
    log('error', 'init', 'MAX_STORAGE_MB invalide', { raw: process.env.MAX_STORAGE_MB })
    process.exit(1)
  }
  if (isNaN(BATCH_SIZE) || BATCH_SIZE <= 0) {
    log('error', 'init', 'SIRENE_BATCH_SIZE invalide', { raw: process.env.SIRENE_BATCH_SIZE })
    process.exit(1)
  }
  if (isNaN(MAX_ROWS_FAILED) || MAX_ROWS_FAILED < 0) {
    log('error', 'init', 'SIRENE_MAX_ROWS_FAILED invalide', {
      raw: process.env.SIRENE_MAX_ROWS_FAILED,
    })
    process.exit(1)
  }

  log('info', 'init', 'ETL SIRENE — démarrage', {
    download_url_override: SIRENE_DOWNLOAD_URL_OVERRIDE,
    max_storage_mb: MAX_STORAGE_MB,
    batch_size: BATCH_SIZE,
    kept_tranches: [...KEPT_TRANCHES],
    kept_naf_sections: [...KEPT_NAF_SECTIONS],
  })

  const supabase: SupabaseClient = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const sourceFile = buildSourceFile()

  let zipPath: string | null = null
  let exitCode = 0
  try {
    const downloadUrl =
      SIRENE_DOWNLOAD_URL_OVERRIDE ?? (await resolveStockEtablissementUrl())
    zipPath = await downloadToTmp(downloadUrl)
    const stats = await processZip(zipPath, sourceFile, supabase)
    const durationMs = Date.now() - startedAt
    // Échec partiel : des batches ont été perdus à l'upsert. On le remonte
    // explicitement dans le résumé et on signale l'échec via le code de sortie
    // si on dépasse le seuil de tolérance (sinon les batches perdus passaient
    // inaperçus, total_upserted sous-comptant sans aucune alerte).
    const partialFailure = stats.rows_failed > MAX_ROWS_FAILED
    log(partialFailure ? 'error' : 'info', 'done', 'ETL SIRENE terminé', {
      total_processed: stats.processed,
      total_kept: stats.kept,
      total_upserted: stats.upserted,
      total_filtered_out: stats.filtered_out,
      batches_failed: stats.batches_failed,
      rows_failed: stats.rows_failed,
      max_rows_failed: MAX_ROWS_FAILED,
      partial_failure: partialFailure,
      rejection_counts: rejectionCounts,
      duration_min: +(durationMs / 60_000).toFixed(2),
      final_size_mb: stats.final_size_mb,
      source_file: sourceFile,
      dry_run: DRY_RUN,
    })
    if (partialFailure) {
      log('error', 'fatal', 'ETL SIRENE en échec partiel — batches perdus à l\'upsert', {
        batches_failed: stats.batches_failed,
        rows_failed: stats.rows_failed,
        max_rows_failed: MAX_ROWS_FAILED,
      })
      exitCode = 3
    }
  } catch (err) {
    if (err instanceof StorageLimitReachedError) {
      log('warn', 'fatal', 'ETL interrompu par garde-fou storage', {
        current_mb: err.currentMb,
        limit_mb: err.limitMb,
        duration_min: +((Date.now() - startedAt) / 60_000).toFixed(2),
      })
      exitCode = 2
    } else {
      log('error', 'fatal', 'Échec ETL SIRENE', {
        message: err instanceof Error ? err.message : String(err),
      })
      exitCode = 1
    }
  } finally {
    if (zipPath) {
      try {
        await unlink(zipPath)
      } catch {
        // best-effort cleanup
      }
    }
  }

  process.exit(exitCode)
}

void main()
