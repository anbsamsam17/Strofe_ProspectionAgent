# Routes & UI — App Router

Structure `app/` :
```
app/
├─ (auth)/          ← route group, layout sans nav
│   ├─ layout.tsx
│   ├─ login/
│   └─ signup/
├─ (dashboard)/     ← route group, layout avec nav user
│   ├─ layout.tsx
│   ├─ dashboard/
│   ├─ daily-list/
│   ├─ pipeline/
│   ├─ prospects/
│   │   ├─ page.tsx
│   │   └─ [id]/
│   └─ settings/
├─ api/             ← endpoints serverless
├─ auth/            ← callback OAuth Supabase
├─ layout.tsx       ← root layout (theme provider, Sentry, fonts)
├─ page.tsx         ← landing /
└─ global-error.tsx
```

## Pages utilisateur

| Route             | Group        | Rôle |
|-------------------|--------------|------|
| `/`               | racine       | Landing |
| `/login`          | (auth)       | Connexion email/mdp Supabase |
| `/signup`         | (auth)       | Inscription |
| `/auth/callback`  | top-level    | Callback OAuth/email link Supabase |
| `/dashboard`      | (dashboard)  | Vue d'ensemble (stats, dernier run) |
| `/daily-list`     | (dashboard)  | Liste des 15 appels du jour, pitchs, formulaire de résultat |
| `/prospects`      | (dashboard)  | Tableau filtrable de tous les prospects |
| `/prospects/[id]` | (dashboard)  | Détail d'un prospect (fiche + historique appels) |
| `/pipeline`       | (dashboard)  | Vue Kanban par statut CRM |
| `/settings`       | (dashboard)  | Configuration agent (NAF cibles, ville, offre, daily_call_target) |

## API endpoints

| Endpoint                          | Méthodes | Auth                          | Rôle |
|-----------------------------------|----------|-------------------------------|------|
| `/api/agent/run`                  | POST     | **Bearer CRON_SECRET** ou session | Mode cron → tous users onboardés. Mode manuel → user courant. |
| `/api/agent/sourcing`             | POST     | session                       | Sourcing pur avec paramètres custom (sans daily list) |
| `/api/agent/status`               | GET      | session                       | État du dernier run (pour UI live) |
| `/api/daily-list`                 | GET      | session                       | Liste du jour pour l'user |
| `/api/daily-list/[id]`            | GET/PATCH| session                       | Détail liste / mise à jour status |
| `/api/daily-list/items`           | PATCH    | session                       | Update d'un item (call_result, notes...) |
| `/api/daily-list/generate`        | POST     | session                       | Génération manuelle de la liste |
| `/api/prospects`                  | GET/POST | session                       | List + create |
| `/api/prospects/[id]`             | GET/PATCH/DELETE | session              | CRUD individuel |
| `/api/profile/settings`           | GET/PUT  | session                       | Lire/mettre à jour `profiles.settings` |
| `/api/notifications/daily`        | POST     | **Bearer CRON_SECRET**        | Cron 7h30 → email Resend "votre liste est prête" |

## Middleware (`middleware.ts`)

Règles d'authentification :
- Crée un client Supabase SSR qui **rafraîchit la session via cookies** (pattern `@supabase/ssr`).
- `PUBLIC_ROUTES = ['/', '/login', '/signup', '/auth/callback']` + tout ce qui commence par `/auth/`.
- **Si non authentifié** et route protégée non-API → redirect `/login?redirect=<pathname>`.
- **Si authentifié** sur `/login` ou `/signup` → redirect `/dashboard`.
- **Routes API** (`/api/*`) : le middleware ne bloque pas — chaque route gère sa propre auth (session ou Bearer). Ajoute uniquement les headers `X-Content-Type-Options: nosniff` et `X-Frame-Options: DENY`.
- Matcher exclut `_next/static`, `_next/image`, `favicon.ico` et les images statiques.

## Auth deux modes pour /api/agent/run

```
┌──────────────────────────────────────────────────────────────────┐
│  1. Header Authorization: Bearer <CRON_SECRET>                   │
│     → isCronRequest() timing-safe (padding 128 octets)           │
│     → mode CRON, boucle sur tous les profiles onboarded=true     │
│                                                                  │
│  2. Sinon : supabase.auth.getUser() depuis cookies SSR           │
│     → si null  → 401 UNAUTHORIZED                                │
│     → si body.userId ≠ user.id → 403 FORBIDDEN                   │
│     → sinon → runAgentNocturne(user.id, supabaseAdmin)           │
│                                                                  │
│  Anti-concurrence : 409 RUN_IN_PROGRESS si agent_runs.running    │
└──────────────────────────────────────────────────────────────────┘
```

L'orchestrator est toujours appelé avec `createAdminClient()` (service_role) parce qu'il insère dans `agent_runs` et travaille à travers plusieurs users en mode cron.
