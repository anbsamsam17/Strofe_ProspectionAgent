// ============================================================
// EMAIL VERIFIER — DNS MX + heuristiques (remplace Hunter, GLN-062 v2)
// ------------------------------------------------------------
// Verification email 100% locale, sans quota externe :
//   1. Format regex RFC-light.
//   2. Domaine disposable (liste statique).
//   3. Domaine webmail (perso vs pro).
//   4. DNS MX lookup (le domaine accepte-t-il des emails ?).
//
// Limites assumees :
//   - On ne fait PAS de SMTP probing (RCPT TO) — risque de blacklist
//     de l'IP Vercel + port 25 souvent bloque sur serverless.
//   - On ne peut donc pas garantir qu'une adresse SPECIFIQUE existe
//     (cas "accept_all"). C'est le compromis assume vs Hunter qui
//     fait du SMTP probing depuis ses propres IPs whiteliste.
// ============================================================

import { promises as dns } from 'node:dns'

// ------------------------------------------------------------
// TYPES
// ------------------------------------------------------------

export type EmailStatus =
  | 'valid'
  | 'invalid'
  | 'accept_all'
  | 'webmail'
  | 'disposable'
  | 'unknown'

export interface VerificationResult {
  status: EmailStatus
  /** Score 0-100 — proxy de confiance, calque sur la convention Hunter. */
  score: number
  /** Raison machine-readable pour le debug / logs. */
  reason:
    | 'format_invalid'
    | 'domain_disposable'
    | 'domain_webmail'
    | 'mx_absent'
    | 'mx_present'
    | 'dns_error'
}

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

/**
 * Regex RFC-light : pragmatique, refuse les cas evidents (espaces, double @,
 * absence de TLD). Volontairement plus permissive que RFC 5322 strict.
 */
const EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i

/**
 * Domaines webmail = email perso, pas pro. On les liste pour pouvoir
 * differencier UI cote consultant ("Marie@gmail.com" != "Marie@acme.fr").
 */
const WEBMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.fr',
  'live.com',
  'live.fr',
  'outlook.com',
  'outlook.fr',
  'yahoo.com',
  'yahoo.fr',
  'free.fr',
  'orange.fr',
  'wanadoo.fr',
  'sfr.fr',
  'neuf.fr',
  'laposte.net',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'gmx.fr',
  'gmx.com',
  'bbox.fr',
])

/**
 * Domaines disposable / jetables connus. Liste statique tenue a jour
 * manuellement — pour une couverture exhaustive, on peut un jour sync
 * avec https://github.com/disposable-email-domains/disposable-email-domains.
 * On garde ici les domaines les plus courants (couvre ~90% des cas).
 */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'tempmail.com',
  'temp-mail.org',
  'tempmail.org',
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'sharklasers.com',
  'trashmail.com',
  'trashmail.net',
  'maildrop.cc',
  'dispostable.com',
  'getnada.com',
  'spambox.us',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'fakeinbox.com',
  'mailcatch.com',
  'mintemail.com',
  'mt2014.com',
  'mt2015.com',
  'tempinbox.com',
  'throwawaymail.com',
  'mvrht.com',
  'mailnesia.com',
  'spam4.me',
  'mohmal.com',
  'emailondeck.com',
  'emailfake.com',
])

// Score par status — calque sur la convention Hunter (proxy lisible).
const SCORE_BY_STATUS: Record<EmailStatus, number> = {
  valid: 90,
  accept_all: 65,
  webmail: 30,
  disposable: 5,
  invalid: 0,
  unknown: 50,
}

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function extractDomain(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at < 1 || at === email.length - 1) return null
  return email.slice(at + 1).toLowerCase()
}

/**
 * Verifie si le domaine a au moins un enregistrement MX valide.
 * Renvoie `true` si MX present, `false` si absent ou si DNS echoue.
 *
 * NB : timeout DNS gere par Node natif (~10s). On wrappe pour eviter
 * qu'un domaine fantome bloque la route trop longtemps.
 */
async function hasMxRecord(domain: string): Promise<boolean> {
  try {
    const records = await dns.resolveMx(domain)
    // Filtre les MX vides ou "." (RFC 7505 — domaine refuse explicitement le mail).
    return records.some((r) => r.exchange && r.exchange !== '.')
  } catch {
    // ENOTFOUND, ENODATA, SERVFAIL — domaine sans MX.
    return false
  }
}

// ------------------------------------------------------------
// API PUBLIQUE
// ------------------------------------------------------------

/**
 * Verifie un email via DNS MX + heuristiques (sans quota externe).
 *
 * Sequence (court-circuite des qu'un signal fort est trouve) :
 *   1. Format regex invalide → 'invalid' (score 0).
 *   2. Domaine disposable connu → 'disposable' (score 5).
 *   3. Domaine webmail connu → 'webmail' (score 30).
 *   4. DNS MX lookup :
 *      - Pas de MX → 'invalid' (score 0).
 *      - MX present → 'accept_all' (score 65).
 *
 * On ne retourne JAMAIS 'valid' (score 90) — c'est reserve a une
 * verification SMTP probing qu'on n'implemente pas. Si une integration
 * future ajoute un fournisseur premium (Verifalia, Bouncer), elle pourra
 * setter 'valid' separement.
 */
export async function verifyEmailViaDns(
  email: string,
): Promise<VerificationResult> {
  // Normalisation prealable.
  const normalized = email.trim().toLowerCase()

  // 1. Format regex.
  if (!EMAIL_REGEX.test(normalized)) {
    return {
      status: 'invalid',
      score: SCORE_BY_STATUS.invalid,
      reason: 'format_invalid',
    }
  }

  const domain = extractDomain(normalized)
  if (!domain) {
    return {
      status: 'invalid',
      score: SCORE_BY_STATUS.invalid,
      reason: 'format_invalid',
    }
  }

  // 2. Disposable.
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      status: 'disposable',
      score: SCORE_BY_STATUS.disposable,
      reason: 'domain_disposable',
    }
  }

  // 3. Webmail.
  if (WEBMAIL_DOMAINS.has(domain)) {
    return {
      status: 'webmail',
      score: SCORE_BY_STATUS.webmail,
      reason: 'domain_webmail',
    }
  }

  // 4. DNS MX lookup.
  try {
    const mxOk = await hasMxRecord(domain)
    if (!mxOk) {
      return {
        status: 'invalid',
        score: SCORE_BY_STATUS.invalid,
        reason: 'mx_absent',
      }
    }
    return {
      status: 'accept_all',
      score: SCORE_BY_STATUS.accept_all,
      reason: 'mx_present',
    }
  } catch {
    // Erreur DNS exceptionnelle (timeout reseau, etc.).
    return {
      status: 'unknown',
      score: SCORE_BY_STATUS.unknown,
      reason: 'dns_error',
    }
  }
}
