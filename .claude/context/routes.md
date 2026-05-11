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
| `/api/agent/sourcing`             | POST     | session                       | Sourcing pur avec paramètres custom (sans daily list) — cf. §Sourcing API |
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

## Sourcing API — POST /api/agent/sourcing

Route durcie en Wave 2 (`fix/sourcing-pagination`, Task 2.3). Voir aussi `.claude/context/sourcing-param-mapping.md`.

### Body (Zod, `.strict()`)

| Champ            | Type         | Contraintes                                        | Défaut si absent              |
|------------------|--------------|----------------------------------------------------|-------------------------------|
| `effectifMin`    | `number?`    | entier, `0 ≤ x ≤ 100_000`                          | défaut runner (50 legacy)     |
| `effectifMax`    | `number?`    | entier, `0 ≤ x ≤ 100_000`, `≥ effectifMin` (refine)| défaut runner (99999 legacy)  |
| `targetSectors`  | `string[]?`  | items regex `/^\d{2}\.\d{2}[A-Z]$/`, max 100       | `NAF_PRIORITAIRES_DEFAULT`    |
| `targetRegion`   | `string?`    | 1..30 chars, regex `/^[\p{L}\d\s'\-]+$/u`          | défaut runner (Gironde legacy)|

`.strict()` rejette tout champ inconnu — defense in depth pour éviter qu'un payload non-validé fuite vers `runSourcing`.

### Auth

`supabase.auth.getUser()` (session SSR via cookies). Vérifiée **avant** le parse du body pour ne pas exposer la surface de validation à un anonyme.

### Réponses

| Status | `code`              | Description                                                |
|--------|---------------------|------------------------------------------------------------|
| 200    | —                   | `{ success, runId, prospectsNew, prospectsUpdated, duration_ms }` |
| 400    | `INVALID_JSON`      | Body non parseable                                         |
| 400    | `VALIDATION_ERROR`  | Zod `.flatten()` dans `details`                            |
| 401    | `UNAUTHORIZED`      | Pas de session                                             |
| 409    | `RUN_IN_PROGRESS`   | Un `agent_runs.status='running'` existe pour l'user        |
| 500    | `SOURCING_FAILED`   | `runSourcing` a throw — `details` uniquement en dev         |

Format erreur (cohérent avec `/api/agent/run`) :

```json
{ "error": "Message FR lisible", "code": "VALIDATION_ERROR", "details": { ... } }
```

### Notes d'implémentation

- Le filter `.eq('user_id', user.id)` sur la query anti-concurrent est **obligatoire** : on utilise `createAdminClient()` (service_role) parce que `runSourcing` insère dans `agent_runs` via le même client. Service_role bypasse RLS — sans ce filter on inspecterait les runs cross-user. Cas légitime d'exception au pattern "pas de filter user_id manuel" (cf. `rules/security.md`).
- `maxDuration = 300` (Vercel Pro) — sourcing peut dépasser 60s (INSEE + ADEME batch).
- `dynamic = 'force-dynamic'` requis car la route lit cookies (session).

### Consommateur UI — `components/dashboard/sourcing-modal.tsx`

Monté via `DashboardHeader` (Client Component, portal sur `document.body`). Aligné sur le contrat Wave 2 (Task 2.4).

**Body envoyé** (camelCase, conforme Zod `.strict()`) :
- `effectifMin: number`, `effectifMax: number` — issus des inputs `<number>` du form
- `targetSectors?: string[]` — codes NAF (`01.21Z`, ...) aplatis depuis les checkboxes `SECTOR_OPTIONS`
- `targetRegion?: string` — code département INSEE (max 5 chars)
- Défauts UI (intentionnellement conservés — Phase 2) : `effectifMin=50`, `effectifMax=500`, aucun secteur, aucune région

**Réponse consommée — formes acceptées** (tolérance ascendante) :
- Forme `{ ok: true, data: { ... } }` (cible Wave 2)
- Forme legacy `{ success: true, prospectsNew, prospectsUpdated, duration_ms, ... }` (200 actuel)
- Champs lus : `prospectsNew`, `prospectsUpdated`, `prospectsQualified?`, `totalAvailable?`, `exhausted: boolean`, `pagesLoaded?`, `durationMs?` (alias `duration_ms`)

**Comportement client** :
- 3 vues internes : `form` → `running` → `results`
- `running` : spinner + message rotatif toutes les 3,5 s (« Recherche... », « Enrichissement BEGES... », « Scoring... », « Pagination Sirene... », « Dédoublonnage... »)
- `AbortController` + timeout client à **5 min** (aligné `maxDuration=300`) — sur `AbortError` → erreur invitant à rafraîchir
- Pendant `running` : ESC, overlay-click et bouton fermer sont neutralisés (anti-interrupt)
- Sur `exhausted: true` → **badge orange** (`bg-orange-100 text-orange-800 border-orange-300`) au-dessus des stats, message indiquant `totalAvailable` si dispo + CTA secondaire « Élargir les filtres » (retour à la vue `form`)
- Sur succès → grille 2 colonnes de `StatCard` : Nouveaux, Mis à jour, Qualifiés (si dispo), Pages Sirene, Durée formatée (`Xs` ou `Ymin Zs`), Univers total (si non-exhausted)
- Erreurs HTTP (4xx/5xx) → retour `form` avec message d'erreur inline (rouge)
- Bouton « Voir les prospects » → `onClose()` + `window.location.reload()`
