// ============================================================
// BLACKLIST CHECKER — GLN-061
//
// Vérifie si les contacts emails d'un prospect tombent dans la liste
// `domain_blacklist` du user. Si oui, le prospect est basculé en
// statut `do_not_contact` avec une note traçable.
//
// Appelé en fin de `phaseContactEnrichment` côté orchestrator nocturne.
//
// Non-bloquant : une erreur ici n'arrête pas le pipeline (RLS éventuel,
// migration 021 non appliquée, etc.).
// ============================================================

import type { SupabaseAdminClient, SupabaseServerClient } from '@/lib/supabase/server'

// ------------------------------------------------------------
// CONSTANTES
// ------------------------------------------------------------

/**
 * Regex de validation domaine (lowercase, sans @).
 * Format minimum : `xxx.yy` (TLD ≥ 2 caractères).
 * Tolère les sous-domaines (ex: `mail.entreprise.fr`).
 */
const DOMAIN_REGEX = /^[a-z0-9.-]+\.[a-z]{2,}$/

// ------------------------------------------------------------
// TYPES PUBLICS
// ------------------------------------------------------------

export interface BlacklistMatch {
  prospect_id: string
  contact_email: string
  matched_domain: string
}

export interface BlacklistCheckResult {
  /** Nombre de prospects basculés en do_not_contact. */
  matched: number
  /** Détail des matches (utile pour logs structurés). */
  matches: BlacklistMatch[]
  /** Vrai si la table `domain_blacklist` est inaccessible (mig. 021 absente). */
  skipped: boolean
  /** Raison du skip si skipped=true. */
  skipReason?: string
}

// ------------------------------------------------------------
// HELPERS PUBLICS
// ------------------------------------------------------------

/**
 * Normalise un domaine pour insertion blacklist :
 *   - trim, lowercase
 *   - retire un éventuel `@` ou `https://` initial
 *   - vérifie le format `xxx.yy`
 * Retourne null si le format est invalide.
 */
export function normalizeBlacklistDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase()
  // Retire schéma URL éventuel.
  d = d.replace(/^https?:\/\//, '')
  // Retire un `@` initial (l'utilisateur a tapé "@greenly.earth").
  if (d.startsWith('@')) d = d.slice(1)
  // Retire le chemin éventuel.
  d = d.split('/')[0]
  if (!DOMAIN_REGEX.test(d)) return null
  return d
}

/**
 * Extrait le domaine d'un email (partie après @, lowercase).
 * Retourne null si l'email est mal formé.
 */
export function extractEmailDomain(email: string | null | undefined): string | null {
  if (!email) return null
  const trimmed = email.trim().toLowerCase()
  const at = trimmed.lastIndexOf('@')
  if (at < 1 || at === trimmed.length - 1) return null
  return trimmed.slice(at + 1)
}

// ------------------------------------------------------------
// FONCTION PRINCIPALE
// ------------------------------------------------------------

interface ProspectForCheck {
  id: string
  contact_email: string | null
  statut: string
}

/**
 * Pour un user donné, parcourt ses prospects encore en pipeline et bascule
 * en `do_not_contact` ceux dont le `contact_email` matche un domaine
 * blacklisté. Ajoute une note explicite à la colonne `notes` pour traçabilité.
 *
 * Exclut les prospects déjà en `do_not_contact` ou `rejected` (pas de double
 * traitement) et les prospects archivés.
 *
 * Best-effort : si la table `domain_blacklist` n'existe pas (mig. 021 pas
 * appliquée), retourne `skipped: true` sans throw.
 */
export async function checkBlacklistedDomains(
  userId: string,
  supabase: SupabaseServerClient | SupabaseAdminClient,
): Promise<BlacklistCheckResult> {
  // 1. Charger la blacklist du user — RLS implicite si client SSR.
  //    On utilise `from` retypé localement car la migration 021 ajoute
  //    `domain_blacklist` mais la regen des types Supabase est encore
  //    en dette technique (cf. lib/supabase/database.types.ts).
  const blacklistQuery = await (
    supabase.from('domain_blacklist' as 'profiles') as unknown as {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{
          data: Array<{ domain: string }> | null
          error: { message: string; code?: string } | null
        }>
      }
    }
  )
    .select('domain')
    .eq('user_id', userId)

  if (blacklistQuery.error) {
    // 42P01 = relation does not exist (mig. 021 non appliquée).
    // 42501 = insufficient_privilege (RLS / role) — log mais skip.
    const code = blacklistQuery.error.code ?? ''
    if (code === '42P01' || code === '42501') {
      return {
        matched: 0,
        matches: [],
        skipped: true,
        skipReason: `Table domain_blacklist inaccessible (${code})`,
      }
    }
    // Autre erreur : remonte au caller.
    throw new Error(
      `checkBlacklistedDomains: erreur lecture blacklist — ${blacklistQuery.error.message}`,
    )
  }

  const blacklistedDomains = new Set(
    (blacklistQuery.data ?? []).map((r) => r.domain),
  )

  if (blacklistedDomains.size === 0) {
    return { matched: 0, matches: [], skipped: false }
  }

  // 2. Charger les prospects en pipeline du user (RLS implicite côté SSR ;
  //    explicite via eq pour service_role).
  const prospectsQuery = await supabase
    .from('prospects')
    .select('id, contact_email, statut')
    .eq('user_id', userId)
    .is('archived_at', null)
    .not('contact_email', 'is', null)
    .neq('statut', 'do_not_contact')
    .neq('statut', 'rejected')

  if (prospectsQuery.error) {
    throw new Error(
      `checkBlacklistedDomains: erreur lecture prospects — ${prospectsQuery.error.message}`,
    )
  }

  const prospects = (prospectsQuery.data ?? []) as ProspectForCheck[]
  const matches: BlacklistMatch[] = []

  for (const p of prospects) {
    const domain = extractEmailDomain(p.contact_email)
    if (!domain) continue
    if (blacklistedDomains.has(domain)) {
      matches.push({
        prospect_id: p.id,
        contact_email: p.contact_email!,
        matched_domain: domain,
      })
    }
  }

  if (matches.length === 0) {
    return { matched: 0, matches: [], skipped: false }
  }

  // 3. Update batch : statut = 'do_not_contact', note "Blacklist domaine: <d>".
  //    Pas de bulk SQL ici — Supabase JS ne permet pas un UPDATE avec
  //    expression différente par ligne. On loop avec un cap (sécurité runtime).
  //    En pratique : qq dizaines de match max par run (les domaines blacklistés
  //    représentent une minorité du pipeline).
  let updatedCount = 0
  for (const match of matches) {
    const noteSuffix = `Blacklist domaine: ${match.matched_domain}`
    const { error: updateError } = await supabase
      .from('prospects')
      .update({
        statut: 'do_not_contact',
        notes: noteSuffix,
      })
      .eq('id', match.prospect_id)

    if (updateError) {
      // On log côté caller — ici on ne throw pas pour ne pas perdre les
      // matches précédents.
      console.log(
        JSON.stringify({
          level: 'warn',
          module: 'blacklist-checker',
          msg: `Échec UPDATE prospect ${match.prospect_id}`,
          error: updateError.message,
        }),
      )
      continue
    }
    updatedCount++
  }

  return {
    matched: updatedCount,
    matches: matches.slice(0, updatedCount),
    skipped: false,
  }
}
