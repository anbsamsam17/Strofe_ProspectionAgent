// ============================================================
// GET  /api/blacklist-domains — liste les domaines blacklistés du user
// POST /api/blacklist-domains — ajoute un domaine à la blacklist
//
// Auth : session Supabase obligatoire. RLS filtre par auth.uid().
// Pas de .eq('user_id', user.id) côté query — RLS s'en charge.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { normalizeBlacklistDomain } from '@/lib/agent/blacklist-checker'

export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// Constantes
// ------------------------------------------------------------

const MAX_DOMAIN_LENGTH = 253 // RFC 1035
const MAX_REASON_LENGTH = 200

// ------------------------------------------------------------
// Schéma Zod
// ------------------------------------------------------------

const PostBodySchema = z.object({
  domain: z
    .string()
    .trim()
    .min(3, 'Domaine trop court')
    .max(MAX_DOMAIN_LENGTH, `Domaine trop long (max ${MAX_DOMAIN_LENGTH} caractères)`),
  reason: z
    .string()
    .trim()
    .max(MAX_REASON_LENGTH, `Raison trop longue (max ${MAX_REASON_LENGTH} caractères)`)
    .optional(),
})

// ------------------------------------------------------------
// GET handler — liste les domaines blacklistés du user courant
// ------------------------------------------------------------

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Non authentifié' } },
      { status: 401 },
    )
  }

  // RLS filtre déjà par auth.uid() — pas de .eq('user_id', ...).
  // Retypage local : `domain_blacklist` ajoutée par mig. 021, regen
  // types Supabase encore en dette technique.
  const { data, error } = await (
    supabase.from('domain_blacklist' as 'profiles') as unknown as {
      select: (cols: string) => {
        order: (
          col: string,
          opts: { ascending: boolean },
        ) => Promise<{
          data: Array<{
            id: string
            domain: string
            reason: string | null
            created_at: string
          }> | null
          error: { message: string } | null
        }>
      }
    }
  )
    .select('id, domain, reason, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    console.log(
      JSON.stringify({
        level: 'error',
        route: '/api/blacklist-domains GET',
        msg: 'Erreur lecture blacklist',
        error: error.message,
        user_id: user.id,
      }),
    )
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Erreur base de données' } },
      { status: 500 },
    )
  }

  return NextResponse.json({ data: data ?? [] }, { status: 200 })
}

// ------------------------------------------------------------
// POST handler — ajoute un domaine
// ------------------------------------------------------------

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Non authentifié' } },
      { status: 401 },
    )
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Corps JSON invalide' } },
      { status: 400 },
    )
  }

  const parsed = PostBodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: parsed.error.message,
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }

  // Normalisation + validation regex domaine.
  const normalized = normalizeBlacklistDomain(parsed.data.domain)
  if (!normalized) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_DOMAIN',
          message:
            'Domaine invalide — format attendu : "exemple.com" sans @, en minuscules',
        },
      },
      { status: 400 },
    )
  }

  const insertPayload = {
    user_id: user.id,
    domain: normalized,
    reason: parsed.data.reason || null,
  }

  // RLS gate côté INSERT via auth.uid() = user_id (cf. migration 021).
  // Retypage local : `domain_blacklist` ajoutée par mig. 021, regen
  // types Supabase encore en dette technique.
  const { data, error } = await (
    supabase.from('domain_blacklist' as 'profiles') as unknown as {
      insert: (row: typeof insertPayload) => {
        select: (cols: string) => {
          single: () => Promise<{
            data: {
              id: string
              domain: string
              reason: string | null
              created_at: string
            } | null
            error: { message: string; code?: string } | null
          }>
        }
      }
    }
  )
    .insert(insertPayload)
    .select('id, domain, reason, created_at')
    .single()

  if (error) {
    // Code 23505 = unique violation Postgres = doublon (user, domain).
    if (error.code === '23505') {
      return NextResponse.json(
        {
          error: {
            code: 'DUPLICATE_DOMAIN',
            message: `Le domaine ${normalized} est déjà dans votre blacklist`,
          },
        },
        { status: 409 },
      )
    }
    console.log(
      JSON.stringify({
        level: 'error',
        route: '/api/blacklist-domains POST',
        msg: 'Erreur insertion blacklist',
        error: error.message,
        code: error.code,
        user_id: user.id,
      }),
    )
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Erreur insertion' } },
      { status: 500 },
    )
  }

  return NextResponse.json({ data }, { status: 201 })
}
