import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'

// Routes accessibles sans authentification.
// /legal/prospection : page d'information CNIL/RGPD — DOIT être publique
// (obligation réglementaire CNIL pour les bases de prospection commerciale).
const PUBLIC_ROUTES = ['/', '/login', '/signup', '/auth/callback', '/legal/prospection']

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Rafraîchit la session si elle a expiré
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Les routes API gèrent leur propre authentification (Bearer token pour cron,
  // session Supabase pour les appels manuels) — ne pas interférer depuis le middleware.
  const isApiRoute = pathname.startsWith('/api/')

  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith('/auth/')
  )

  // Redirige vers /login si non authentifié sur une route protégée (hors API)
  if (!user && !isPublicRoute && !isApiRoute) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    redirectUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // Redirige vers /prospects (nouvelle home post-login) si déjà authentifié sur une page auth.
  // /prospects a remplacé /dashboard comme page d'accueil du dashboard.
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/prospects'
    return NextResponse.redirect(redirectUrl)
  }

  // Security headers pour les routes API
  if (pathname.startsWith('/api/')) {
    supabaseResponse.headers.set('X-Content-Type-Options', 'nosniff')
    supabaseResponse.headers.set('X-Frame-Options', 'DENY')
  }

  return supabaseResponse
}

export const config = {
  // Exclusions :
  //   - _next/static, _next/image : assets Next.js
  //   - favicon.ico, manifest.json : conventions web
  //   - sitemap.xml, robots.txt : SEO — DOIVENT être servis 200 publiquement
  //     (sinon Google reçoit un 307 -> /login et n'indexe rien)
  //   - extensions image : optimisations Next/Image servies depuis /public
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
