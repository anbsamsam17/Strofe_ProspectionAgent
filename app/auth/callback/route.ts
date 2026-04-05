import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/supabase/database.types'

/**
 * GET /auth/callback?code=xxx
 *
 * Route handler pour l'échange du code PKCE Supabase.
 * Utilisé après :
 * - Confirmation d'email lors de l'inscription (signUp)
 * - Connexion OAuth (Google, GitHub…) si activé plus tard
 *
 * Flux :
 * 1. Supabase envoie l'utilisateur ici avec ?code=xxx
 * 2. On échange le code contre une session (PKCE flow)
 * 3. Redirection vers /dashboard ou vers /login en cas d'erreur
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  // Paramètre optionnel : URL de redirection après connexion
  // Ex : /login?redirect=/dashboard/settings
  const next = searchParams.get('next') ?? '/dashboard'

  // Sécurité : on s'assure que `next` est un chemin relatif
  // pour éviter les redirections ouvertes (open redirect)
  // Note : `//evil.com` est interprété comme protocol-relative URL par les navigateurs
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'

  if (!code) {
    // Pas de code = tentative invalide ou lien expiré
    return NextResponse.redirect(
      new URL('/login?error=auth_error&message=Lien+invalide+ou+expiré', origin)
    )
  }

  const cookieStore = await cookies()

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        },
      },
    }
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] Erreur échange de code :', error.message)
    return NextResponse.redirect(
      new URL(
        `/login?error=auth_error&message=${encodeURIComponent('La session a expiré. Veuillez vous reconnecter.')}`,
        origin
      )
    )
  }

  return NextResponse.redirect(new URL(safeNext, origin))
}
