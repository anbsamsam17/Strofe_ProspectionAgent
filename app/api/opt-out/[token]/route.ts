import { type NextRequest, NextResponse } from 'next/server'

import { createClient as createAdminClient } from '@supabase/supabase-js'

import { verifyOptOutToken } from '@/lib/auth/opt-out-token'

// ============================================================
// Opt-out 1 clic — RGPD article 21 (droit d'opposition)
//
// Token URL-safe HMAC signé contenant { u: user_id, s?: siren, e?: email, exp }.
// Cliquable depuis tout email de prospection envoyé via Resend.
// L'insert dans `opt_out` est fait via service_role (pas de session).
//
// Le helper `generateOptOutToken` vit dans `lib/auth/opt-out-token.ts`
// (Next.js 15 interdit les exports utilitaires depuis un route handler).
// ============================================================

export const dynamic = 'force-dynamic'

function htmlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }) as NextResponse
}

function pageOK(): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Désinscription confirmée</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#0a0e1a;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}main{max-width:480px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px;backdrop-filter:blur(8px)}h1{color:#fff;font-size:1.5rem;margin:0 0 12px}p{color:#d1d5db;line-height:1.6}a{color:#22d3ee;text-decoration:underline}</style>
</head><body><main><h1>Désinscription confirmée</h1><p>Vous avez été retiré de notre liste de prospection. Vous ne recevrez plus d&rsquo;email de notre part.</p><p><a href="/legal/prospection">En savoir plus sur le traitement de vos données</a></p></main></body></html>`
}

function pageError(reason: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Lien invalide</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#0a0e1a;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}main{max-width:480px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px;backdrop-filter:blur(8px)}h1{color:#fca5a5;font-size:1.5rem;margin:0 0 12px}p{color:#d1d5db;line-height:1.6}a{color:#22d3ee;text-decoration:underline}</style>
</head><body><main><h1>Lien invalide ou expiré</h1><p>Ce lien de désinscription n&rsquo;est plus valide (raison&nbsp;: ${reason}). Vous pouvez nous contacter directement à <a href="mailto:contact@strofe.fr">contact@strofe.fr</a> pour exercer votre droit d&rsquo;opposition.</p></main></body></html>`
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  const secret = process.env.OPT_OUT_HMAC_SECRET
  if (!secret) {
    return htmlResponse(pageError('config'), 500)
  }

  const verified = verifyOptOutToken(token, secret)
  if (!verified.ok) {
    return htmlResponse(pageError(verified.reason), 400)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return htmlResponse(pageError('config'), 500)
  }

  const supabase = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error } = await supabase.from('opt_out').insert({
    user_id: verified.payload.u,
    siren: verified.payload.s ?? null,
    email: verified.payload.e ?? null,
    reason: 'email-unsubscribe-1click',
  })

  if (error) {
    console.error(
      JSON.stringify({
        module: 'opt-out',
        error: error.message,
      }),
    )
    return htmlResponse(pageError('db'), 500)
  }

  console.log(
    JSON.stringify({
      module: 'opt-out',
      user_id_prefix: verified.payload.u.slice(0, 4),
      has_siren: Boolean(verified.payload.s),
      has_email: Boolean(verified.payload.e),
    }),
  )

  return htmlResponse(pageOK(), 200)
}
