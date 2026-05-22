// ============================================================
// BEGES — Détection d'expiration imminente (GLN-080, scope réduit)
//
// Calcule si la validité d'un BEGES publié arrive à échéance dans
// les 90 jours qui viennent. Sert à afficher un badge orange UI
// "BEGES expirant" sur la fiche prospect et dans la liste.
//
// Périodes de validité — Article L229-25 + Décret 2022-982 (GLN-005) :
//   - Privé : 4 ans à compter de la date de publication
//   - Public (catégorie juridique INSEE 71xx-74xx) : 3 ans
//
// Scope volontairement réduit (vs ticket initial) :
//   - Pas de cron, pas d'email, pas de notification système.
//   - Juste un helper pur consommé par l'UI (page prospect + liste).
// ============================================================

/**
 * Fenêtre "expiration imminente" : on flagge si l'expiration tombe
 * dans [aujourd'hui, aujourd'hui + 90 jours]. Au-delà, le prospect
 * n'est pas encore "urgent" ; en deçà (déjà expiré), il l'est plus
 * que ça (badge BEGES expiré dédié).
 */
const EXPIRATION_WINDOW_DAYS = 90

/** Validité d'un BEGES — années (cf. lib/agent/sourcing.ts GLN-005). */
const VALIDITE_PRIVE_ANS = 4
const VALIDITE_PUBLIC_ANS = 3

/**
 * Type d'entrée minimal pour le helper : on n'a besoin que de la date
 * de dernière publication BEGES et du flag entité publique.
 */
interface ProspectExpirationInput {
  beges_derniere_publication: string | null
  entite_publique: boolean | null
}

/**
 * Parse une date YYYY-MM-DD (ou ISO complet) en Date UTC.
 * Retourne null si le format est invalide.
 */
function parseDate(raw: string | null | undefined): Date | null {
  if (typeof raw !== 'string' || raw.length < 10) return null
  const iso = raw.substring(0, 10)
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Ajoute `years` années à une date (en gardant le même jour/mois).
 * UTC — pas de souci de fuseau horaire.
 */
function addYearsUtc(d: Date, years: number): Date {
  return new Date(
    Date.UTC(
      d.getUTCFullYear() + years,
      d.getUTCMonth(),
      d.getUTCDate(),
    ),
  )
}

/**
 * Retourne `true` si la date d'expiration du BEGES tombe dans la fenêtre
 * `[now, now + 90 jours]`.
 *
 * Retourne `false` dans tous les autres cas :
 *   - Pas de date de publication connue.
 *   - BEGES déjà expiré (date < now).
 *   - Expiration > 90 jours dans le futur.
 *
 * @param prospect partie minimale d'un Prospect (date publi + flag public)
 * @param now      Date de référence (injectée en test, défaut = `new Date()`)
 */
export function isBegesExpiringSoon(
  prospect: ProspectExpirationInput,
  now: Date = new Date(),
): boolean {
  const publication = parseDate(prospect.beges_derniere_publication)
  if (publication === null) return false

  const validiteAns =
    prospect.entite_publique === true ? VALIDITE_PUBLIC_ANS : VALIDITE_PRIVE_ANS

  const expirationDate = addYearsUtc(publication, validiteAns)
  const expirationTs = expirationDate.getTime()
  const nowTs = now.getTime()

  if (expirationTs < nowTs) return false // déjà expiré
  const windowEndTs = nowTs + EXPIRATION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  return expirationTs <= windowEndTs
}
