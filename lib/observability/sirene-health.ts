// ============================================================
// OBSERVABILITY — Sirene health monitoring
//
// Détecte le pattern "Sirene KO récurrent" (3 KO consécutifs) sur une même
// instance Vercel (lambda warm) et alerte Sentry au seuil.
//
// Pourquoi :
//   - Une erreur Sirene ponctuelle (timeout, 5xx isolé) est bruit.
//   - Trois erreurs Sirene consécutives sans intercaler 1 succès → signal de
//     dégradation réelle de l'API Sirene/INSEE qu'on veut remonter au-dessus
//     du bruit habituel.
//
// Périmètre :
//   - Module standalone, NON wiré dans `sourcing.ts` dans ce commit (sera
//     intégré dans A5/A7 après coordination).
//   - State module-level : reset au cold start lambda (acceptable, c'est
//     justement la fenêtre d'observation pertinente côté instance Vercel).
//   - Pas de persistence DB : redondant avec `agent_runs.logs` qui garde
//     l'historique complet.
//
// PII : aucune. Les `SireneFailureContext` ne contiennent que des paramètres
// techniques (curseur INSEE, status HTTP, snippet body API).
// ============================================================

import { addBreadcrumb, captureException } from '@sentry/nextjs'

// ------------------------------------------------------------
// STATE
// ------------------------------------------------------------

let _consecutiveFailures = 0

/**
 * Seuil de déclenchement d'alerte Sentry. À partir de 3 KO consécutifs, on
 * considère Sirene comme dégradée.
 */
const ALERT_THRESHOLD = 3

// ------------------------------------------------------------
// TYPES PUBLICS
// ------------------------------------------------------------

export interface SireneFailureContext {
  /** Status HTTP renvoyé par Sirene (undefined si fetch a thrown avant). */
  status: number | undefined
  /** Snippet du body de réponse (premier extrait) pour debug. Pas de PII. */
  body?: string
  /** Numéro de page Sirene en cours au moment de l'échec. */
  page: number
  /** Index du chunk NAF/code-postal multiplexé au moment de l'échec. */
  chunk_index: number
  /** Curseur Sirene utilisé pour la requête (`*` au premier appel). */
  curseur: string
}

export interface SireneHealthStats {
  consecutive_failures: number
  threshold: number
  is_degraded: boolean
}

// ------------------------------------------------------------
// API PUBLIQUE
// ------------------------------------------------------------

/**
 * À appeler depuis le runner Sirene après chaque appel échoué.
 *
 * Comportement :
 *   - Pose toujours un breadcrumb Sentry (`category: 'sirene'`).
 *   - Incrémente le compteur module-level.
 *   - Si on franchit ou dépasse le seuil → `captureException` avec tags
 *     `sirene.degraded=true` et `sirene.consecutive_failures=N`, ET log
 *     warn JSON structuré sur stdout (visible dans Vercel logs).
 *
 * Le `captureException` est rejoué à CHAQUE échec une fois le seuil atteint
 * (3, 4, 5, …) — c'est volontaire : Sentry déduplique côté serveur par
 * fingerprint (Error name + tags), donc pas d'explosion. Permet de garder
 * une visibilité "ça dure" sans dropper l'alerte sur la 4e occurrence.
 */
export function trackSireneFailure(ctx: SireneFailureContext): void {
  _consecutiveFailures += 1

  // Breadcrumb à chaque échec (1, 2, 3, …) pour reconstituer la chronologie
  // dans l'event Sentry qui sera émis au seuil.
  addBreadcrumb({
    category: 'sirene',
    message: 'KO',
    data: { ...ctx, consecutive_failures: _consecutiveFailures },
    level: 'warning',
  })

  if (_consecutiveFailures >= ALERT_THRESHOLD) {
    // Log structuré (visible Vercel) — niveau warn pour éviter de polluer
    // les logs error de Sentry par double remontée.
    console.warn(
      JSON.stringify({
        level: 'warn',
        module: 'sirene-health',
        msg: 'CRITICAL DEGRADATION',
        consecutive_failures: _consecutiveFailures,
      }),
    )

    captureException(new Error('Sirene degradation critical'), {
      tags: {
        'sirene.degraded': 'true',
        'sirene.consecutive_failures': String(_consecutiveFailures),
      },
      extra: { ...ctx, consecutive_failures: _consecutiveFailures },
    })
  }
}

/**
 * À appeler après chaque appel Sirene réussi.
 *
 * Reset le compteur à 0. Si on revenait d'une période de dégradation
 * (> 0 failures avant ce succès), pose un breadcrumb "OK after N failures"
 * pour matérialiser la récupération dans Sentry.
 */
export function trackSireneSuccess(): void {
  const previous = _consecutiveFailures
  _consecutiveFailures = 0

  if (previous > 0) {
    addBreadcrumb({
      category: 'sirene',
      message: `OK after ${previous} failures`,
      level: 'info',
    })
  }
}

/**
 * Stats de santé Sirene pour exposition admin/observability.
 *
 * `is_degraded` passe à `true` dès que le compteur atteint le seuil. Permet
 * à une route admin ou un dashboard de surveiller l'état courant sans
 * dépendre de Sentry.
 */
export function getSireneHealthStats(): SireneHealthStats {
  return {
    consecutive_failures: _consecutiveFailures,
    threshold: ALERT_THRESHOLD,
    is_degraded: _consecutiveFailures >= ALERT_THRESHOLD,
  }
}

// ------------------------------------------------------------
// HELPERS TESTS
// ------------------------------------------------------------

/** Exposé uniquement pour les tests — ne pas utiliser en prod. */
export function _resetSireneHealthForTests(): void {
  _consecutiveFailures = 0
}
