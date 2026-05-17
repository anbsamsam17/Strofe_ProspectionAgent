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

const DEFAULT_SIRENE_URL =
  'https://files.data.gouv.fr/insee-sirene/StockEtablissement_utf8.zip'

const SIRENE_DOWNLOAD_URL =
  process.env.SIRENE_DOWNLOAD_URL ?? DEFAULT_SIRENE_URL

const MAX_STORAGE_MB = parseInt(process.env.MAX_STORAGE_MB ?? '100', 10)
const BATCH_SIZE = parseInt(process.env.SIRENE_BATCH_SIZE ?? '500', 10)

const LOG_EVERY_ROWS = 10_000
const STORAGE_CHECK_EVERY_ROWS = 10_000

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

function mapRow(row: SireneCsvRow, sourceFile: string): SireneCacheRow | null {
  // ---- Filtre BEGES strict (early-skip) ----
  if (row.etatAdministratifEtablissement !== 'A') return null
  if (row.etablissementSiege !== 'true') return null

  const tranche = row.trancheEffectifsEtablissement?.trim()
  if (!tranche || !KEPT_TRANCHES.has(tranche)) return null

  const naf = normalizeNaf(row.activitePrincipaleEtablissement)
  const section = sectionFromNaf(naf)
  if (!section || !KEPT_NAF_SECTIONS.has(section)) return null

  const siren = row.siren?.trim()
  const siret = row.siret?.trim()
  if (!siren || !siret) return null
  // Validation format : SIREN = 9 chiffres, SIRET = 14 chiffres.
  if (!/^\d{9}$/.test(siren)) return null
  if (!/^\d{14}$/.test(siret)) return null

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

async function flushBatch(supabase: SupabaseClient, batch: SireneCacheRow[]): Promise<number> {
  if (batch.length === 0) return 0
  const { error } = await supabase
    .from('sirene_cache')
    .upsert(batch, { onConflict: 'siren', ignoreDuplicates: false })
  if (error) {
    log('error', 'upsert', 'Erreur upsert batch', {
      batch_size: batch.length,
      first_siren: batch[0]?.siren,
      message: error.message,
    })
    return 0
  }
  return batch.length
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
  constructor(public readonly currentMb: number, public readonly limitMb: number) {
    super(
      `Garde-fou storage : sirene_cache atteint ${currentMb.toFixed(2)} MB, limite ${limitMb} MB`,
    )
    this.name = 'StorageLimitReachedError'
  }
}

// ---------------------------------------------------------------------------
// DOWNLOAD — stream-fetch vers /tmp avec retry exponentiel
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  let batch: SireneCacheRow[] = []
  let lastSizeMb: number | null = null

  const directory = await unzipper.Open.file(zipPath)
  const csvEntry = directory.files.find((f) => f.path.endsWith('.csv'))
  if (!csvEntry) {
    throw new Error('Aucun .csv trouvé dans le ZIP SIRENE')
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

  for await (const rawRow of parser) {
    processed++
    const mapped = mapRow(rawRow as SireneCsvRow, sourceFile)
    if (mapped) {
      kept++
      batch.push(mapped)
      if (batch.length >= BATCH_SIZE) {
        upserted += await flushBatch(supabase, batch)
        batch = []
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
    if (processed % STORAGE_CHECK_EVERY_ROWS === 0) {
      // On flush avant de mesurer pour avoir une taille à jour.
      if (batch.length > 0) {
        upserted += await flushBatch(supabase, batch)
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
    upserted += await flushBatch(supabase, batch)
  }

  // Mesure finale
  const finalStat = await getStorageStat(supabase)

  return {
    processed,
    filtered_out: processed - kept,
    kept,
    upserted,
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

  log('info', 'init', 'ETL SIRENE — démarrage', {
    download_url: SIRENE_DOWNLOAD_URL,
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
    zipPath = await downloadToTmp(SIRENE_DOWNLOAD_URL)
    const stats = await processZip(zipPath, sourceFile, supabase)
    const durationMs = Date.now() - startedAt
    log('info', 'done', 'ETL SIRENE terminé', {
      total_processed: stats.processed,
      total_kept: stats.kept,
      total_upserted: stats.upserted,
      total_filtered_out: stats.filtered_out,
      duration_min: +(durationMs / 60_000).toFixed(2),
      final_size_mb: stats.final_size_mb,
      source_file: sourceFile,
    })
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
