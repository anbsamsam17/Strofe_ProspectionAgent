// ============================================================
// LOOKUP RAISON SOCIALE — enrichissement batch via Recherche Entreprises
//
// Problème résolu : le fichier INSEE StockEtablissement_utf8.csv ne contient
// PAS la dénomination de l'unité légale (champ denominationUniteLegale). Celle-ci
// réside dans StockUniteLegale_utf8.csv qu'on ne télécharge pas. Les SIREN
// sourcés depuis sirene_cache ont donc raison_sociale NULL en base.
//
// Solution : appel à l'API Recherche Entreprises (api.gouv.fr) — gratuite,
// sans auth, retourne `nom_complet` ou `nom_raison_sociale` pour chaque SIREN.
//
// Pattern :
//   - Découpe en groupes de `parallelism` (défaut 7, aligne avec 7 req/s gouv).
//   - Promise.all par groupe (parallélisme intra-groupe).
//   - Attente `throttleMs` entre 2 groupes (défaut 1 100 ms ≈ 1 groupe/s).
//   - Skip silencieux des SIREN inconnus / timeout / erreur réseau.
//   - Retourne Map<siren, raisonSociale> avec uniquement les SIREN résolus.
//   - Respect AbortSignal : sort proprement si signal.aborted.
//   - Idempotent : peut être rappelé plusieurs fois sans effet de bord.
//
// Rate limit : 7 req/s. Ne pas augmenter `parallelism` au-delà de 7 sans
// vérification car l'API gouv peut throttle sans code 429 documenté.
// ============================================================

import { fetchRechercheEntreprisesData } from './recherche-entreprises-dirigeants'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

const DEFAULT_PARALLELISM = 7
const DEFAULT_THROTTLE_MS = 1_100
const DEFAULT_TIMEOUT_MS = 8_000
const LOG_MODULE = 'lookup-raison-sociale'

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function logInfo(phase: string, extra: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      level: 'info',
      module: LOG_MODULE,
      phase,
      ts: new Date().toISOString(),
      ...extra,
    }),
  )
}

function logWarn(phase: string, extra: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      level: 'warn',
      module: LOG_MODULE,
      phase,
      ts: new Date().toISOString(),
      ...extra,
    }),
  )
}

/**
 * Attend `ms` millisecondes en respectant l'AbortSignal.
 * Résout immédiatement si `signal` est déjà aborté.
 */
function throttle(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

// ------------------------------------------------------------
// FONCTION PRINCIPALE
// ------------------------------------------------------------

/**
 * Résout la raison sociale d'un batch de SIREN via l'API Recherche Entreprises.
 *
 * Seuls les SIREN effectivement résolus figurent dans la Map retournée.
 * Les SIREN inconnus / en erreur / timeout sont silencieusement ignorés
 * (pipeline dégradé — le nom restera 'Inconnu' en DB, et sera retryé
 * lors d'un prochain backfill).
 *
 * @param sirens      Liste de SIREN à résoudre (format 9 chiffres).
 * @param options     parallelism (défaut 7), throttleMs (défaut 1100),
 *                    timeoutMs (défaut 8000), signal pour annulation.
 * @returns           Map<siren, raisonSociale> — uniquement les SIREN résolus.
 */
export async function fetchRaisonSocialesBatch(
  sirens: string[],
  options: {
    parallelism?: number
    throttleMs?: number
    timeoutMs?: number
    signal?: AbortSignal
  } = {},
): Promise<Map<string, string>> {
  const parallelism = options.parallelism ?? DEFAULT_PARALLELISM
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const { signal } = options

  const result = new Map<string, string>()

  if (sirens.length === 0) return result

  const startedAt = Date.now()
  logInfo('start', { total: sirens.length, parallelism, throttle_ms: throttleMs })

  // Découpe en groupes de taille `parallelism`.
  for (let offset = 0; offset < sirens.length; offset += parallelism) {
    if (signal?.aborted) {
      logWarn('aborted', {
        offset,
        resolved_so_far: result.size,
        msg: 'AbortSignal déclenché — sortie anticipée',
      })
      break
    }

    const group = sirens.slice(offset, offset + parallelism)

    // Chaque appel isole son erreur : une exception dans fetchRechercheEntreprisesData
    // ne casse pas le groupe (la fonction est censée retourner null en cas d'erreur,
    // mais on ajoute un try/catch défensif pour les cas où un mock ou une dépendance
    // externe lève une exception inattendue).
    const settled = await Promise.all(
      group.map(async (siren) => {
        try {
          const data = await fetchRechercheEntreprisesData(siren, { timeoutMs })
          return { siren, raisonSociale: data?.raisonSociale ?? null }
        } catch (err) {
          logWarn('fetch-error', {
            siren,
            error: err instanceof Error ? err.message : String(err),
          })
          return { siren, raisonSociale: null }
        }
      }),
    )

    for (const { siren, raisonSociale } of settled) {
      if (raisonSociale && raisonSociale.trim().length > 0) {
        result.set(siren, raisonSociale.trim())
      }
    }

    // Throttle entre groupes (sauf après le dernier groupe).
    const isLastGroup = offset + parallelism >= sirens.length
    if (!isLastGroup) {
      await throttle(throttleMs, signal)
    }
  }

  const durationMs = Date.now() - startedAt
  const successRate = sirens.length > 0 ? Math.round((result.size / sirens.length) * 100) : 0

  logInfo('done', {
    total_requested: sirens.length,
    resolved: result.size,
    skipped: sirens.length - result.size,
    success_rate_pct: successRate,
    duration_ms: durationMs,
  })

  return result
}
