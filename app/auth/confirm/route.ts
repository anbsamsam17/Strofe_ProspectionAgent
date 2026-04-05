import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { EmailOtpType } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

/**
 * GET /auth/confirm?token_hash=xxx&type=email
 *
 * Route handler pour les Magic Links et les confirmations OTP.
 * Utilisé après :
 * - Connexion par Magic Link (type = 'magiclink')
 * - Confirmation d'email lors de l'inscription (type = 'email' ou 'signup')
 * - Réinitialisation de mot de passe (type = 'recovery')
 *
 * Flux :
 * 1. Supabase envoie l'utilisateur ici avec ?token_hash=xxx&type=xxx
 * 2. On vérifie le token OTP (verifyOtp)
 * 3. Redirection vers /dashboard ou /login en cas d'erreur
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  // Paramètre optionnel : URL de redirection post-connexion
  // Note : `//evil.com` est interprété comme protocol-relative URL par les navigateurs
  const next = searchParams.get('next') ?? '/dashboard'
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'

  // Les deux paramètres sont obligatoires
  if (!token_hash || !type) {
    return NextResponse.redirect(
      new URL('/login?error=auth_error&message=Lien+de+confirmation+invalide', origin)
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

  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash,
  })

  if (error) {
    console.error('[auth/confirm] Erreur vérification OTP :', error.message)

    // Token expiré vs token invalide — messages différenciés
    const isExpired =
      error.message.includes('expired') || error.message.includes('Token has expired')

    const message = isExpired
      ? 'Ce lien a expiré. Veuillez en demander un nouveau.'
      : 'Lien de confirmation invalide. Veuillez réessayer.'

    return NextResponse.redirect(
      new URL(
        `/login?error=auth_error&message=${encodeURIComponent(message)}`,
        origin
      )
    )
  }

  // Connexion réussie — redirection vers le dashboard (ou next)
  return NextResponse.redirect(new URL(safeNext, origin))
}
