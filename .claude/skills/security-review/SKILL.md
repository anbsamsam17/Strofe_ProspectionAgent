---
name: security-review
description: "Audit sécurité de l'agent de prospection bilan carbone : RLS Supabase, service_role, CRON_SECRET, Zod, secrets. À activer quand l'utilisateur demande audit, review sécu, vérifier RLS, security scan."
---

# Skill : Security Review — Agent IA Prospection Bilan Carbone

Activé quand l'utilisateur mentionne : audit, review sécu, sécurité, vérifier RLS, security scan, pentest.

Lis d'abord `rules/security.md` qui contient les règles de référence.

## 1. RLS Supabase

Pour chaque table (`profiles`, `prospects`, `daily_lists`, `daily_list_items`, `agent_runs`) :

- Vérifier qu'il existe **4 policies** : SELECT, INSERT, UPDATE, DELETE.
- Chaque policy contient `auth.uid() = user_id` dans `USING` et/ou `WITH CHECK`.
- Source : `supabase/migrations/001_initial.sql` + migrations suivantes.
- Test manuel : se connecter en user A, tenter de SELECT un row appartenant à user B — doit retourner 0 ligne, pas une erreur.

## 2. Service role key côté client (CRITIQUE)

```bash
grep -rn "SERVICE_ROLE" app/ components/ lib/
```

- Doit apparaître uniquement dans `app/api/agent/run/`, `app/api/notifications/daily/`, et un wrapper `lib/supabase/server.ts` si applicable.
- **Aucune** occurrence dans un fichier `'use client'`, ni dans `components/`, ni dans une page rendue côté client. Si oui → bug critique, fix immédiat.

## 3. CRON_SECRET — timing safe

```bash
grep -rn "CRON_SECRET" lib/ app/
```

- Les comparaisons doivent **toutes** passer par `isCronRequest()` de `lib/auth/cron.ts` (qui utilise `crypto.timingSafeEqual`).
- `grep -rn "CRON_SECRET ===" .` ne doit **rien** retourner.
- Le token ne doit pas apparaître dans des logs Sentry ni dans `agent_runs.error_message`.

## 4. Type bypass

```bash
grep -rn "as any" app/ lib/ components/
```

Chaque occurrence est suspecte. Soit elle est justifiable et doit être commentée, soit il faut typer correctement (Zod / type guard).

## 5. Validation Zod sur chaque route API

Pour chaque `app/api/**/route.ts` qui accepte un body :
- Il doit y avoir un `z.object({...}).safeParse(await req.json())` avant toute query DB.
- Une route qui fait `await req.json()` puis utilise les champs directement = vulnérabilité (injection, crash).

## 6. Whitelist domaines (SSRF)

```bash
grep -rn "fetch(" lib/ app/api/
```

Vérifier que chaque `fetch()` cible un domaine de la whitelist (`rules/security.md`). Pas de variable user-controlled dans l'URL.

## 7. Secrets in-code

```bash
grep -rEn "(sk-[A-Za-z0-9]{20,}|re_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,})" .
```

Aucun match attendu. Si match : rotation immédiate du secret + retire du code + force-push uniquement après concertation.

## 8. PII dans Sentry

Vérifier `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` :
- Hook `beforeSend` présent.
- Scrub des emails (regex `/\S+@\S+\.\S+/`) et téléphones (regex `/\+?\d[\d\s.-]{8,}/`) du payload.

## Rapport

Classer les findings :
- **Critique** (fix immédiat, blocant deploy) : service_role exposée client, `CRON_SECRET ===`, RLS manquante, secret en clair.
- **Moyen** (sprint suivant) : `as any` non justifiés, route sans Zod, fetch sans whitelist explicite.
- **Faible** (backlog) : nommage, commentaires, optimisations.

Documenter les findings critiques dans `memory/hindsight.md` avec date.
