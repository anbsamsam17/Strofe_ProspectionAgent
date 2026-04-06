import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/supabase/database.types'

/** Type alias pour le client Supabase côté serveur (compatible @supabase/ssr v0.10). */
export type SupabaseServerClient = ReturnType<typeof createServerClient<Database>>

/** Type alias pour le client admin (service_role) — sans cookies, sans session. */
export type SupabaseAdminClient = ReturnType<typeof createSupabaseClient<Database>>

// Client Supabase pour usage côté serveur (Server Components + API Routes)
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // setAll appelé depuis un Server Component — ignoré (OK)
          }
        },
      },
    }
  )
}

// Client avec service role — uniquement pour les API Routes sécurisées
// (cron jobs, webhooks) — NE PAS exposer côté client.
//
// SÉCURITÉ : utilise createClient de @supabase/supabase-js directement
// (pas createServerClient de @supabase/ssr) car le client service_role
// n'a pas besoin de cookies ni de session utilisateur. Cela supprime une
// dépendance inutile au contexte Next.js (cookies()) et élimine le risque
// de fuite de la clé service_role via les cookies du navigateur.
//
// SYNC : cette fonction est synchrone — pas de `await cookies()`.
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
