# API Design — Agent IA Prospection Bilan Carbone

> Pattern standard pour toutes les routes API de ce projet.

---

## Localisation

- Toutes les routes sous `app/api/<path>/route.ts`.
- Exports nommés : `GET`, `POST`, `PATCH`, `DELETE`. Pas de `export default`.
- Une route par responsabilité. Pas de switch sur `?action=` à la PHP.

## Pattern standard

Ordre obligatoire dans chaque handler authentifié :

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const bodySchema = z.object({ /* ... */ })

export async function POST(req: NextRequest) {
  // 1. Client Supabase SSR
  const supabase = await createClient()

  // 2. Check auth — getUser (pas getSession, qui ne revalide pas)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Non authentifié' } },
      { status: 401 },
    )
  }

  // 3. Validation Zod du body
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: parsed.error.message } },
      { status: 400 },
    )
  }

  // 4. Query Supabase — RLS filtre implicitement via la session
  const { data, error } = await supabase.from('prospects').select('*')
  if (error) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 },
    )
  }

  // 5. Réponse JSON
  return NextResponse.json({ data }, { status: 200 })
}
```

## Pas de filter user_id manuel

La session Supabase SSR + les policies RLS font le filtrage. **Ne jamais** écrire :

```ts
// ANTI-PATTERN — sentinelle d'une RLS cassée ou mal comprise
.eq('user_id', user.id)
```

Si tu as besoin de cette ligne, c'est qu'une policy RLS manque ou est buggée. Fix la policy, pas le query. Voir `rules/security.md`.

## Format de réponse

### Succès
```json
{ "data": { ... } }
```

### Erreur
```json
{ "error": { "code": "INVALID_INPUT", "message": "..." } }
```

Codes d'erreur cohérents (string court SCREAMING_SNAKE) : `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_INPUT`, `NOT_FOUND`, `RATE_LIMITED`, `DB_ERROR`, `EXTERNAL_API_ERROR`, `INTERNAL_ERROR`.

## Codes HTTP

- `200` succès.
- `201` création (POST qui crée une ressource).
- `400` validation échouée (Zod).
- `401` non authentifié (pas de session).
- `403` authentifié mais pas le droit (rare avec RLS — la query renvoie vide, pas 403).
- `404` ressource non trouvée.
- `429` rate limit (Hunter quota, OpenAI RPM).
- `500` erreur serveur non gérée.

## Routes cron

- Protégées par `isCronRequest(req)` de `lib/auth/cron.ts`. Voir `rules/security.md`.
- Pas de check `auth.getUser()` — les crons ne sont pas une session user.
- Utilisent un client Supabase **service_role** (pas SSR). Cf. `rules/security.md` sur l'isolation de ce client.
- Routes cron actuelles : `app/api/agent/run/route.ts`, `app/api/notifications/daily/route.ts`.

## Idempotence

- `POST` qui crée une ressource potentiellement rejouable (cron retry, double-clic) doit accepter une `client_key` ou un identifiant naturel (siren pour un prospect) et faire un upsert plutôt qu'un insert.
- Les routes cron sont idempotentes par construction (un `agent_run` par jour, upsert sur `daily_lists`).

## Réponses

- **Toujours JSON.** Pas de HTML, pas de redirect 302 depuis une route `app/api/`.
- Pas de réponse vide (`return new Response(null)`) — au minimum `{ data: null }` ou `{ status: 'ok' }`.
- `Content-Type: application/json` géré automatiquement par `NextResponse.json()`.

## Logs et observabilité

- Erreurs serveur (500) remontent à Sentry via `instrumentation.ts`.
- Pas de `console.log` en succès. Logger uniquement les anomalies (avec contexte : `user.id`, `route`, `prospect.id` si dispo). Pas de PII (cf. `rules/security.md`).
