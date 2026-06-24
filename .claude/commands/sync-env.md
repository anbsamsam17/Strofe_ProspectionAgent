---
description: "Vérifie que .env.local contient toutes les clés attendues, sans afficher les valeurs."
---

# /sync-env

Tu compares `.env.local` avec la liste des variables attendues par le projet. **N'AFFICHE JAMAIS** la valeur d'une variable, même tronquée.

## 1. Référence

1. Si `.env.example` existe : lis-le et extrais les clés (lignes non commentées avant `=`).
2. Sinon : utilise la liste ci-dessous, obtenue par grep de `process.env.*` dans `lib/**` et `app/**`.

### Liste de référence

**Supabase**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (SERVER ONLY)

**Gemini** — `GEMINI_API_KEY` (`gemini-2.0-flash`, scoring d'intérêt commercial + raisons)

**INSEE Sirene** — `INSEE_CLIENT_ID`, `INSEE_CLIENT_SECRET` (OAuth2, token valide 7j)

**Enrichissement contact** — `PAPPERS_API_KEY`, `HUNTER_API_KEY`

**Email** — `RESEND_API_KEY`, `EMAIL_FROM` (domaine vérifié Resend)

**Cron** — `CRON_SECRET` (Bearer, cf. `lib/auth/cron.ts`)

**Monitoring** — `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`

**App** — `NEXT_PUBLIC_APP_URL`

## 2. Comparaison

1. Lis `.env.local` ligne par ligne — extrais uniquement les **noms** de variables.
2. Sors :

```
Clés présentes : <count>
Clés manquantes : <count>

Manquantes :
- VAR_NAME (où la trouver)

Présentes hors référence (à investiguer) :
- VAR_NAME
```

3. **Aucune valeur** dans le rapport, même partielle.

## 3. Sources des clés manquantes

- `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY` → Supabase dashboard → Project Settings → API
- `GEMINI_API_KEY` → aistudio.google.com → API Keys (`gemini-2.0-flash`)
- `INSEE_CLIENT_*` → api.insee.fr → application → identifiants OAuth2 (régénérer si > 7j)
- `PAPPERS_API_KEY` → pappers.fr → Espace Pro → API
- `HUNTER_API_KEY` → hunter.io → Settings → API
- `RESEND_API_KEY`, `EMAIL_FROM` → resend.com → API Keys + domaine vérifié
- `CRON_SECRET` → `openssl rand -hex 32` (à synchroniser avec Vercel Cron)
- `SENTRY_*` → sentry.io → settings projet + Auth Tokens (scope `project:releases`)

## 4. Vérifications complémentaires

1. `.env.local` est dans `.gitignore`.
2. `.env.example` (si présent) ne contient AUCUNE valeur réelle — placeholders uniquement.
3. Si plusieurs environnements : suggère un `.env.development.local` séparé.

## 5. Rapport final

Tout OK : "Environnement local synchronisé — <count> clés présentes, aucune manquante."
Sinon : liste les manquantes avec leur source, sans valeur.
