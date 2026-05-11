---
description: "Scaffold une route handler Next.js avec auth Supabase et validation Zod."
argument-hint: "<path> <méthode>"
---

# /new-api-route

Tu crées une nouvelle route API. Argument : `$ARGUMENTS` (ex: `daily-list/archive POST` → `app/api/daily-list/archive/route.ts`).

## 1. Préparation

1. Parse `$ARGUMENTS` : path Next.js + méthode HTTP (GET / POST / PATCH / DELETE).
2. Vérifie que `app/api/<path>/` n'existe pas — sinon éditer la route existante.
3. Inspire-toi des routes du repo :
   - GET liste paginée : `app/api/prospects/route.ts`
   - POST création : `app/api/prospects/route.ts`
   - PATCH mise à jour : `app/api/prospects/[id]/route.ts`
   - Cron protégé : `app/api/agent/run/route.ts`

## 2. Template

```ts
// <MÉTHODE> /api/<path> — <objectif>. Auth : session Supabase obligatoire.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({ /* champs typés */ })

export async function <MÉTHODE>(request: NextRequest) {
  // 1. Auth
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Non authentifié', code: 'UNAUTHORIZED' }, { status: 401 })
  }
  // 2. Validation
  let body: z.infer<typeof BodySchema>
  try {
    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Paramètres invalides', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors },
        { status: 400 })
    }
    body = parsed.data
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide', code: 'INVALID_JSON' }, { status: 400 })
  }
  // 3. Query Supabase (RLS implicite via session)
  const { data, error } = await supabase.from('<table>').select('*').limit(20)
  if (error) {
    return NextResponse.json({ error: 'Erreur base de données', code: 'DB_ERROR' }, { status: 500 })
  }
  return NextResponse.json({ data }, { status: 200 })
}
```

## 3. Règles obligatoires

1. **Toujours** `createClient()` (session user, RLS active). `createAdminClient()` uniquement pour cron + auth Bearer (cf. `lib/auth/cron.ts`).
2. **Toujours** un schéma Zod avant toute query. Pour GET : valide aussi `request.nextUrl.searchParams`.
3. **Jamais** de `any` dans les retours. Préfère les types `ApiError` / `ApiSuccess<T>` de `lib/types.ts`.
4. Codes erreur : `UNAUTHORIZED`, `VALIDATION_ERROR`, `INVALID_JSON`, `DB_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`.
5. Status HTTP : 200/201 OK, 400 validation, 401 auth, 403 interdit, 404 pas trouvé, 409 conflit, 500 serveur.
6. Ne JAMAIS exposer le message d'erreur DB en prod — derrière `process.env.NODE_ENV === 'development'` si besoin.

## 4. Validation

1. `npm run type-check`.
2. `curl` la route avec payload valide, invalide, et sans session.
3. Si la route fait partie du pipeline agent : lance `/test-agent-run`.
