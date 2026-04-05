// ============================================================
// GET  /api/prospects?page=1&limit=20&statut=&secteur=&search=
// POST /api/prospects  — ajout manuel d'un prospect
// Auth : session Supabase obligatoire sur les deux routes.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { ProspectStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// Constantes
// ------------------------------------------------------------

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

// Statuts valides (typage runtime aligné avec l'ENUM PostgreSQL)
const PROSPECT_STATUTS: [ProspectStatus, ...ProspectStatus[]] = [
  'sourced',
  'qualified',
  'contacted',
  'interested',
  'rdv',
  'converted',
  'rejected',
  'on_hold',
]

// ------------------------------------------------------------
// Schémas Zod
// ------------------------------------------------------------

const GetQuerySchema = z.object({
  page: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .refine((n) => n >= 1, 'page doit être >= 1')
    .optional()
    .default('1'),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .refine((n) => n >= 1 && n <= MAX_LIMIT, `limit doit être entre 1 et ${MAX_LIMIT}`)
    .optional()
    .default(String(DEFAULT_LIMIT)),
  statut: z.enum(PROSPECT_STATUTS).optional(),
  secteur: z.string().max(10).optional(),
  search: z.string().max(100).trim().optional(),
})

const PostBodySchema = z.object({
  siren: z
    .string()
    .length(9, 'SIREN doit faire exactement 9 chiffres')
    .regex(/^\d{9}$/, 'SIREN invalide — 9 chiffres uniquement'),
  raison_sociale: z.string().min(1).max(300).trim(),
  siret: z
    .string()
    .length(14, 'SIRET doit faire 14 chiffres')
    .regex(/^\d{14}$/)
    .optional(),
  secteur_naf: z.string().max(6).optional(),
  secteur_libelle: z.string().max(200).optional(),
  effectif_min: z.number().int().min(0).optional(),
  effectif_max: z.number().int().min(0).optional(),
  ville: z.string().max(100).optional(),
  code_postal: z.string().max(10).optional(),
  adresse: z.string().max(500).optional(),
  contact_nom: z.string().max(100).optional(),
  contact_prenom: z.string().max(100).optional(),
  contact_poste: z.string().max(200).optional(),
  contact_telephone: z
    .string()
    .max(20)
    .regex(/^[\d\s\+\-\(\)\.]+$/, 'Numéro de téléphone invalide')
    .optional(),
  contact_email: z.string().email('Email invalide').max(254).optional(),
  contact_linkedin: z.string().url('URL LinkedIn invalide').max(500).optional(),
})

// ------------------------------------------------------------
// Sécurité : échappement des caractères spéciaux PostgREST
// Les caractères , . ( ) : * ont une signification syntaxique
// dans les filtres PostgREST et doivent être échappés avec
// un backslash avant toute interpolation dans un filtre .or()
// ------------------------------------------------------------

function sanitizeSearchParam(s: string): string {
  return s.replace(/[,.()\:*\\]/g, (char) => `\\${char}`)
}

// ------------------------------------------------------------
// GET handler
// ------------------------------------------------------------

export async function GET(request: NextRequest) {
  // -- Auth --
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      { error: 'Non authentifié', code: 'UNAUTHORIZED' },
      { status: 401 },
    )
  }

  // -- Validation query params --
  const { searchParams } = new URL(request.url)

  const parsed = GetQuerySchema.safeParse({
    page: searchParams.get('page') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
    statut: searchParams.get('statut') ?? undefined,
    secteur: searchParams.get('secteur') ?? undefined,
    search: searchParams.get('search') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Paramètres de requête invalides',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  const { page, limit, statut, secteur, search } = parsed.data

  const offset = (page - 1) * limit

  // -- Construction de la requête avec filtres dynamiques --
  let query = supabase
    .from('prospects')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)

  if (statut) {
    query = query.eq('statut', statut)
  }

  if (secteur && secteur.trim() !== '') {
    // Filtre sur les 2 premiers caractères du code NAF (secteur niveau 2)
    query = query.ilike('secteur_naf', `${secteur}%`)
  }

  if (search && search.trim() !== '') {
    // Recherche full-text sur raison_sociale, siren, ville
    // Échappement des caractères spéciaux PostgREST pour éviter l'injection
    const safe = sanitizeSearchParam(search)
    query = query.or(
      `raison_sociale.ilike.%${safe}%,siren.eq.${safe},ville.ilike.%${safe}%`,
    )
  }

  const { data: prospects, error: queryError, count } = await query
    .order('score_priorite', { ascending: false })
    .range(offset, offset + limit - 1)

  if (queryError) {
    console.log(
      JSON.stringify({
        level: 'error',
        route: '/api/prospects GET',
        msg: 'Erreur récupération prospects',
        error: queryError.message,
      }),
    )
    return NextResponse.json(
      { error: 'Erreur base de données', code: 'DB_ERROR' },
      { status: 500 },
    )
  }

  const total = count ?? 0
  const totalPages = Math.ceil(total / limit)

  return NextResponse.json(
    {
      prospects: prospects ?? [],
      total,
      page,
      totalPages,
    },
    { status: 200 },
  )
}

// ------------------------------------------------------------
// POST handler
// ------------------------------------------------------------

export async function POST(request: NextRequest) {
  // -- Auth --
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      { error: 'Non authentifié', code: 'UNAUTHORIZED' },
      { status: 401 },
    )
  }

  // -- Parsing + validation du body --
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Corps JSON invalide', code: 'INVALID_JSON' },
      { status: 400 },
    )
  }

  const parsed = PostBodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Paramètres invalides',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  const body = parsed.data

  // -- Vérification doublon SIREN pour cet user --
  const { data: existing } = await supabase
    .from('prospects')
    .select('id, siren')
    .eq('user_id', user.id)
    .eq('siren', body.siren)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      {
        error: `Un prospect avec le SIREN ${body.siren} existe déjà`,
        code: 'DUPLICATE_SIREN',
      },
      { status: 409 },
    )
  }

  // -- Insertion --
  const { data: newProspect, error: insertError } = await supabase
    .from('prospects')
    .insert({
      user_id: user.id,
      ...body,
      source: 'manual',
      score_priorite: 0,
      score_details: {},
      signaux: [],
      statut: 'sourced',
      beges_publie: false,
      obligation_beges: false,
    })
    .select()
    .single()

  if (insertError) {
    // Détection doublon via contrainte unique (race condition possible)
    if (insertError.code === '23505') {
      return NextResponse.json(
        {
          error: `Un prospect avec le SIREN ${body.siren} existe déjà`,
          code: 'DUPLICATE_SIREN',
        },
        { status: 409 },
      )
    }

    console.log(
      JSON.stringify({
        level: 'error',
        route: '/api/prospects POST',
        msg: 'Erreur insertion prospect',
        error: insertError.message,
        code: insertError.code,
      }),
    )
    return NextResponse.json(
      { error: 'Erreur création du prospect', code: 'INSERT_FAILED' },
      { status: 500 },
    )
  }

  return NextResponse.json({ prospect: newProspect }, { status: 201 })
}
