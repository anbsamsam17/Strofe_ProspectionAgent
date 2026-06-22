// ============================================================
// OPT-OUT CHECKER — Agent IA Prospection Bilan Carbone
//
// Vérifie / écrit la table `opt_out` (migration 015) — liste RGPD des SIREN
// et emails que l'user ne doit plus jamais contacter.
//
// Côté sourcing : `filterOptedOutSirens` retire les SIREN bannis avant
//                 même de les passer en cascade d'enrichissement.
// Côté pitch    : `isOptedOut` revérifie au moment de la génération (defense in depth).
// Côté UI       : `addOptOut` est appelée par le handler "1 clic désinscription"
//                 d'un email de prospection (lien `?optout=...`).
//
// Sécurité : la table opt_out est RLS strict (auth.uid() = user_id) — un user
// ne peut voir/modifier que ses propres opt-outs. On filtre quand même
// explicitement par user_id côté code pour rester compatible avec un client
// admin (service_role) utilisé par le pipeline cron.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

// ------------------------------------------------------------
// HELPERS INTERNES
// ------------------------------------------------------------

const TABLE = 'opt_out'

/**
 * Le type `Database` peut ne pas encore exporter `opt_out` selon la fraîcheur
 * de `database.types.ts`. On utilise un client générique pour ne pas casser
 * le type-check tant que `npx supabase gen types` n'a pas été rerun.
 */
type AnyClient = SupabaseClient<any, 'public', any>

interface OptOutRow {
  siren: string | null
  email: string | null
}

// ------------------------------------------------------------
// API PUBLIQUE
// ------------------------------------------------------------

/**
 * Vérifie si un SIREN ou un email donné est listé en opt_out pour cet user.
 *
 * - Au moins l'une des deux clés doit être fournie (sinon `false`, no-op).
 * - Comparaison email : case-insensitive (l'index DB est sur `lower(email)`).
 * - Erreurs DB : on retourne `false` (mode "fail-open" pour ne pas bloquer
 *   le pipeline en cas de souci infra — la prochaine passe relèvera).
 *
 * ATTENTION — fail-open : en cas d'erreur DB cette fonction considère le
 * prospect comme NON opté-out. Ne JAMAIS la réutiliser telle quelle sur un
 * chemin d'envoi direct (email/SMS), où une erreur doit au contraire bloquer
 * l'envoi (fail-closed). Cf. la route d'envoi email qui implémente le contrôle
 * opt-out en fail-closed.
 *
 * @returns `true` si l'un des critères matche une ligne opt_out, sinon `false`.
 */
export async function isOptedOut(
  supabase: SupabaseClient,
  userId: string,
  options: { siren?: string; email?: string },
): Promise<boolean> {
  const { siren, email } = options
  if (!siren && !email) return false

  const client = supabase as unknown as AnyClient
  const emailLower = email?.toLowerCase()

  // Check SIREN (index partiel `opt_out_user_siren_idx`)
  if (siren) {
    const { data, error } = await client
      .from(TABLE)
      .select('id')
      .eq('user_id', userId)
      .eq('siren', siren)
      .limit(1)
      .maybeSingle()
    if (!error && data) return true
  }

  // Check email (index partiel `opt_out_user_email_idx` sur `lower(email)`)
  if (emailLower) {
    const { data, error } = await client
      .from(TABLE)
      .select('id')
      .eq('user_id', userId)
      .ilike('email', emailLower)
      .limit(1)
      .maybeSingle()
    if (!error && data) return true
  }

  return false
}

/**
 * Filtre une liste de SIREN en retirant ceux présents dans `opt_out` pour cet user.
 *
 * Utilisé au sourcing pour ne plus jamais re-sourcer un refus :
 *   - SIREN refusé hier → reste en opt_out → exclu du run de ce soir.
 *
 * Implémenté en une seule requête `IN (...)` (pas N+1).
 *
 * @returns Sous-ensemble de `sirens` qui NE sont PAS en opt_out.
 *          En cas d'erreur DB, retourne la liste inchangée (fail-open).
 */
export async function filterOptedOutSirens(
  supabase: SupabaseClient,
  userId: string,
  sirens: string[],
): Promise<string[]> {
  if (!sirens.length) return []

  const client = supabase as unknown as AnyClient
  const { data, error } = await client
    .from(TABLE)
    .select('siren')
    .eq('user_id', userId)
    .in('siren', sirens)

  if (error || !data) return sirens

  const blocked = new Set<string>()
  for (const row of data as Array<Pick<OptOutRow, 'siren'>>) {
    if (row.siren) blocked.add(row.siren)
  }

  if (!blocked.size) return sirens
  return sirens.filter((s) => !blocked.has(s))
}

/**
 * Insère un opt-out (siren et/ou email) pour cet user.
 *
 * Typiquement déclenché par le handler "1 clic désinscription" embarqué dans
 * un email de prospection (cf. politique RGPD CNIL recommandation 2021).
 *
 * - Idempotent en pratique : si la même ligne existe déjà, on accepte le
 *   doublon côté DB (pas de UNIQUE sur la table — c'est de l'append-only).
 *   On ne lève donc pas d'erreur applicative sur "already exists".
 * - Au moins `siren` ou `email` doit être fourni (CHECK constraint DB).
 *
 * @returns `{ ok: true }` si la ligne a été créée, `{ ok: false }` sinon
 *          (input vide, ou erreur DB).
 */
export async function addOptOut(
  supabase: SupabaseClient,
  userId: string,
  data: { siren?: string; email?: string; reason?: string },
): Promise<{ ok: boolean }> {
  const { siren, email, reason } = data
  if (!siren && !email) return { ok: false }

  const client = supabase as unknown as AnyClient
  const row = {
    user_id: userId,
    siren: siren ?? null,
    email: email ? email.toLowerCase() : null,
    reason: reason ?? null,
  }

  const { error } = await client.from(TABLE).insert(row as never)
  if (error) return { ok: false }
  return { ok: true }
}
