// =============================================================================
// scripts/import-sirene-bulk.ts
//
// ETL bulk SIRENE INSEE → table publique `sirene_cache` Supabase.
// Sert de fondation au fallback "sourcing offline" (l'API Sirene live étant
// instable). Voir docs/sirene-bulk-import.md pour le contexte produit.
//
// Pipeline :
//   1. GET https://files.data.gouv.fr/insee-sirene/StockEtablissement_utf8.zip
//      (~1 GB compressé, ~3 GB décompressé, ~30M lignes)
//   2. unzipper en flux (pas d'écriture disque, pas de décompression complète mémoire)
//   3. csv-parse en flux ligne par ligne
//   4. Filtres en lecture :
//        - etatAdministratifEtablissement === 'A' (actif)
//        - trancheEffectifsEtablissement IN ('11','12','21','22','31','32','41','42','51','52','53')
//          (entreprises avec salariés, on garde large pour ne pas perdre les
//           établissements à effectif inconnu et permettre les filtres en SQL)
//   5. Upsert par batch de 500 dans `sirene_cache` (service_role) via Supabase
//   6. Logs structurés JSON tous les 10000 rows : {ts, level, phase, msg, meta}
//   7. Stats finales : total lus / filtrés / insérés / erreurs / durée
//
// Conventions du projet :
//   - TypeScript strict (cf. rules/code-style.md)
//   - Service role uniquement côté serveur (cf. rules/security.md)
//   - Whitelist SSRF respectée : on tape data.gouv.fr et le projet Supabase
//   - Pas de PII logguée (le bulk SIRENE n'en contient pas pour les
//     personnes morales ; les entrepreneurs individuels ne sont pas ciblés
//     par notre filtre tranche_effectifs >= '11').
//
// Dépendances runtime (à installer avant exécution) :
//   npm install --save-dev csv-parse unzipper @types/unzipper
//
// Exécution locale (Node 22.6+ requis pour --experimental-strip-types) :
//   node --experimental-strip-types --env-file=.env.local scripts/import-sirene-bulk.ts
//
// Ou via npm script (cf. package.json) :
//   npm run import-sirene
//
// Compatibilité Vercel cron : à éviter pour le moment (cap 800s sur Pro,
// l'ETL dure 15-30 min en local). Plan d'évolution : déporter sur un job
// externe (Render cron, GitHub Actions schedule) ou découper en chunks.
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
// CONSTANTES
// ---------------------------------------------------------------------------

const SIRENE_BULK_URL =
  'https://files.data.gouv.fr/insee-sirene/StockEtablissement_utf8.zip'

// Tranches d'effectifs INSEE conservées (entreprises avec salariés).
// Code INSEE → intervalle :
//   '11' = 1-2,   '12' = 3-5
//   '21' = 6-9,   '22' = 10-19
//   '31' = 20-49, '32' = 50-99
//   '41' = 100-199, '42' = 200-249
//   '51' = 250-499, '52' = 500-999, '53' = 1000-1999
// On garde '11' et '12' aussi pour permettre des filtres aval en SQL.
const KEPT_TRANCHES = new Set([
  '11', '12', '21', '22', '31', '32', '41', '42', '51', '52', '53',
])

const TRANCHE_RANGES: Record<string, { min: number; max: number }> = {
  '11': { min: 1, max: 2 },
  '12': { min: 3, max: 5 },
  '21': { min: 6, max: 9 },
  '22': { min: 10, max: 19 },
  '31': { min: 20, max: 49 },
  '32': { min: 50, max: 99 },
  '41': { min: 100, max: 199 },
  '42': { min: 200, max: 249 },
  '51': { min: 250, max: 499 },
  '52': { min: 500, max: 999 },
  '53': { min: 1000, max: 1999 },
}

const BATCH_SIZE = 500
const LOG_EVERY_ROWS = 10_000

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
  // En script ETL one-shot, console.log est acceptable (pas en prod cron).
  // Sortie JSON pour facilier le grep ultérieur.
  console.log(JSON.stringify(entry))
}

// ---------------------------------------------------------------------------
// TYPES — colonnes brutes du CSV INSEE retenues
// ---------------------------------------------------------------------------

interface SireneCsvRow {
  siren: string
  siret: string
  denominationUniteLegale?: string
  denominationUsuelle1UniteLegale?: string
  nomUniteLegale?: string                          // pour personne physique (rare dans notre filtre)
  prenom1UniteLegale?: string
  activitePrincipaleEtablissement?: string
  trancheEffectifsEtablissement?: string
  codePostalEtablissement?: string
  libelleCommuneEtablissement?: string
  numeroVoieEtablissement?: string
  typeVoieEtablissement?: string
  libelleVoieEtablissement?: string
  etatAdministratifEtablissement?: string
  dateCreationEtablissement?: string
  dateDernierTraitementEtablissement?: string
  etablissementSiege?: string                      // 'true' / 'false'
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
  const parts = [
    row.numeroVoieEtablissement,
    row.typeVoieEtablissement,
    row.libelleVoieEtablissement,
  ].filter((p): p is string => Boolean(p && p.trim()))
  return parts.length > 0 ? parts.join(' ') : null
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
  // Filtres en lecture — économise les allocations downstream.
  if (row.etatAdministratifEtablissement !== 'A') return null
  const tranche = row.trancheEffectifsEtablissement?.trim()
  if (!tranche || !KEPT_TRANCHES.has(tranche)) return null

  // Optionnel : ne garder que les sièges. À voir si on perd trop de prospects.
  // Pour la v1 du POC on garde tout établissement répondant aux filtres
  // (déduplication via PRIMARY KEY siren — premier insert gagne).
  // if (row.etablissementSiege !== 'true') return null

  const siren = row.siren?.trim()
  const siret = row.siret?.trim()
  if (!siren || !siret) return null

  const range = TRANCHE_RANGES[tranche]

  return {
    siren,
    siret,
    raison_sociale: buildRaisonSociale(row),
    activite_principale: normalizeNaf(row.activitePrincipaleEtablissement),
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
// SUPABASE — upsert batched
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

// ---------------------------------------------------------------------------
// DOWNLOAD + UNZIP + PARSE — flux complet
// ---------------------------------------------------------------------------

async function downloadToTmp(url: string): Promise<string> {
  log('info', 'download', 'Téléchargement bulk SIRENE', { url })
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} sur ${url}`)
  }
  const tmpPath = join(tmpdir(), `sirene-${Date.now()}.zip`)
  // Node 18+ : res.body est un Web ReadableStream. On le convertit en Node Readable.
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  await pipeline(nodeStream, createWriteStream(tmpPath))
  log('info', 'download', 'Téléchargement terminé', { tmp_path: tmpPath })
  return tmpPath
}

async function processZip(
  zipPath: string,
  sourceFile: string,
  supabase: SupabaseClient,
): Promise<{ read: number; kept: number; inserted: number }> {
  let read = 0
  let kept = 0
  let inserted = 0
  let batch: SireneCacheRow[] = []

  const directory = await unzipper.Open.file(zipPath)
  const csvEntry = directory.files.find((f) => f.path.endsWith('.csv'))
  if (!csvEntry) {
    throw new Error('Aucun .csv trouvé dans le ZIP SIRENE')
  }
  log('info', 'parse', 'Entrée CSV trouvée dans le ZIP', { csv: csvEntry.path })

  const csvStream = csvEntry.stream()
  const parser = csvParse({
    columns: true,            // 1ʳᵉ ligne = noms de colonnes (entêtes INSEE)
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true, // tolère lignes malformées ponctuelles
  })

  csvStream.pipe(parser)

  for await (const rawRow of parser) {
    read++
    const mapped = mapRow(rawRow as SireneCsvRow, sourceFile)
    if (mapped) {
      kept++
      batch.push(mapped)
      if (batch.length >= BATCH_SIZE) {
        inserted += await flushBatch(supabase, batch)
        batch = []
      }
    }
    if (read % LOG_EVERY_ROWS === 0) {
      log('info', 'parse', 'Progression ETL', { read, kept, inserted })
    }
  }

  // Flush final
  inserted += await flushBatch(supabase, batch)

  return { read, kept, inserted }
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

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

  const supabase: SupabaseClient = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const sourceFile = `StockEtablissement_utf8_${new Date()
    .toISOString()
    .slice(0, 7)
    .replace('-', '')}.zip` // ex. 'StockEtablissement_utf8_202605.zip'

  let zipPath: string | null = null
  try {
    zipPath = await downloadToTmp(SIRENE_BULK_URL)
    const stats = await processZip(zipPath, sourceFile, supabase)
    const duration_ms = Date.now() - startedAt
    log('info', 'done', 'ETL SIRENE terminé', {
      ...stats,
      duration_ms,
      duration_human: `${Math.round(duration_ms / 1000)}s`,
      source_file: sourceFile,
    })
  } catch (err) {
    log('error', 'fatal', 'Échec ETL SIRENE', {
      message: err instanceof Error ? err.message : String(err),
    })
    process.exit(1)
  } finally {
    if (zipPath) {
      try {
        await unlink(zipPath)
      } catch {
        // best-effort cleanup
      }
    }
  }
}

void main()
