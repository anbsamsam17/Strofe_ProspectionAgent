// ============================================================
// POST /api/prospects/bulk-delete
//
// Supprime en masse les prospects de l'utilisateur courant qui
// correspondent aux filtres passés dans le body. Filtres identiques
// au GET /prospects (page tableau) pour garantir la cohérence visuelle.
//
// Sécurité :
//   - Session Supabase obligatoire (auth.getUser).
//   - RLS Supabase filtre par auth.uid() — aucun filtre .eq('user_id') ajouté.
//   - Validation Zod stricte du body.
//   - Au moins UN filtre doit être fourni (refus de DELETE FROM prospects).
//
// Réponse : { data: { deleted: number } }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { ProspectStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

// ------------------------------------------------------------
// Constantes
// ------------------------------------------------------------

const PROSPECT_STATUTS: [ProspectStatus, ...ProspectStatus[]] = [
  'sourced',
  'qualified',
  'contacted',
  'interested',
  'rdv',
  'offer_sent',
  'converted',
  'rejected',
  'on_hold',
]

const CONTACT_TYPES = ['phone', 'email', 'linkedin'] as const
type ContactFilterType = (typeof CONTACT_TYPES)[number]

const CONTACT_FIELD_BY_TYPE: Record<ContactFilterType, string> = {
  phone: 'contact_telephone',
  email: 'contact_email',
  linkedin: 'contact_linkedin',
}

const BEGES_FILTERS = ['missing', 'obligation'] as const

// ------------------------------------------------------------
// Schéma Zod — mêmes filtres que la page /prospects
// ------------------------------------------------------------

const BodySchema = z.object({
  filters: z
    .object({
      // statut : tableau de statuts (multi-select pills côté UI).
      statut: z.array(z.enum(PROSPECT_STATUTS)).max(PROSPECT_STATUTS.length).optional(),
      secteur: z.string().max(100).trim().optional(),
      score_min: z.number().int().min(0).max(100).optional(),
      archived: z.boolean().optional(),
      contact_type: z.array(z.enum(CONTACT_TYPES)).max(CONTACT_TYPES.length).optional(),
      beges: z.array(z.enum(BEGES_FILTERS)).max(BEGES_FILTERS.length).optional(),
    })
    .default({}),
})

// ------------------------------------------------------------
// Helper : un filtre est-il "actif" ?
// On refuse un bulk-delete sans aucun filtre — garde-fou critique.
// ------------------------------------------------------------

function hasActiveFilter(filters: z.infer<typeof BodySchema>['filters']): boolean {
  return Boolean(
    (filters.statut && filters.statut.length > 0) ||
      (filters.secteur && filters.secteur.length > 0) ||
      (filters.score_min !== undefined && filters.score_min > 0) ||
      filters.archived === true ||
      (filters.contact_type && filters.contact_type.length > 0) ||
      (filters.beges && filters.beges.length > 0),
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
      { error: { code: 'UNAUTHENTICATED', message: 'Non authentifié' } },
      { status: 401 },
    )
  }

  // -- Parsing + validation du body --
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Corps JSON invalide' } },
      { status: 400 },
    )
  }

  const parsed = BodySchema.safeParse(raw)
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

  const { filters } = parsed.data

  // -- Garde-fou : refuser un bulk-delete "tout supprimer" --
  if (!hasActiveFilter(filters)) {
    return NextResponse.json(
      {
        error: {
          code: 'NO_FILTER',
          message:
            'Au moins un filtre est requis pour la suppression en masse — refus de supprimer toute la base.',
        },
      },
      { status: 400 },
    )
  }

  // -- Construction de la query DELETE avec filtres identiques au GET --
  // RLS filtre déjà par auth.uid() côté DB (cf. .claude/rules/security.md).
  let query = supabase.from('prospects').delete({ count: 'exact' })

  // Mode archivés : afficher les archivés OU les non-archivés (jamais les deux).
  if (filters.archived === true) {
    query = query.not('archived_at', 'is', null)
  } else {
    query = query.is('archived_at', null)
  }

  if (filters.statut && filters.statut.length > 0) {
    query = query.in('statut', filters.statut)
  }

  if (filters.secteur && filters.secteur.trim() !== '') {
    query = query.ilike('secteur_libelle', `%${filters.secteur}%`)
  }

  if (filters.score_min !== undefined && filters.score_min > 0) {
    query = query.gte('score_priorite', filters.score_min)
  }

  if (filters.contact_type && filters.contact_type.length > 0) {
    // OR sur les canaux choisis : un prospect matche s'il a au moins un canal.
    const orClause = filters.contact_type
      .map((t) => `${CONTACT_FIELD_BY_TYPE[t]}.not.is.null`)
      .join(',')
    query = query.or(orClause)
  }

  if (filters.beges && filters.beges.includes('obligation')) {
    query = query.eq('obligation_beges', true)
  }
  if (filters.beges && filters.beges.includes('missing')) {
    query = query.or('beges_publie.eq.false,beges_valide.eq.false')
  }

  const { error: deleteError, count } = await query

  if (deleteError) {
    console.log(
      JSON.stringify({
        level: 'error',
        route: '/api/prospects/bulk-delete POST',
        msg: 'Erreur suppression bulk prospects',
        error: deleteError.message,
      }),
    )
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Erreur suppression' } },
      { status: 500 },
    )
  }

  return NextResponse.json({ data: { deleted: count ?? 0 } }, { status: 200 })
}
