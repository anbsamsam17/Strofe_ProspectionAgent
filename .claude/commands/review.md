---
description: "Code review d'une PR ou d'un diff selon les standards du projet."
argument-hint: "<chemin fichier ou range git, ex: HEAD~1>"
---

# /review

Tu reviews du code de l'agent de prospection BEGES. Cible : `$ARGUMENTS` (chemin fichier, ou range git type `HEAD~1`, ou vide = diff staged).

## 1. Identification du périmètre

1. Si l'argument est vide : `git diff --staged --name-only` puis `git diff --name-only HEAD~1` si rien n'est staged.
2. Si c'est un chemin : revue ciblée du fichier.
3. Liste les fichiers à reviewer, puis lis-les un par un. Ne suppose rien — lis le code réel.

## 2. Checklist obligatoire

### Typage strict
- [ ] Aucun `any` explicite ou implicite. Si un `unknown` est utilisé, il est narrow avec Zod ou type guard.
- [ ] Les types DB viennent de `lib/supabase/database.types.ts` ou des modèles dans `lib/types.ts`. Pas de duplication.
- [ ] Les retours de fonction async sont annotés `Promise<T>` quand non triviaux.

### Sécurité Supabase / RLS
- [ ] Toute query côté API Route utilise `createClient()` de `lib/supabase/server.ts` (qui hérite de la session user) — pas `createAdminClient()` sauf justification cron/admin claire.
- [ ] Si `createAdminClient()` est utilisé : la route a une auth manuelle (Bearer `CRON_SECRET` ou check `user.id` explicite). Le service_role bypass RLS, donc tout filtre `user_id` doit être ajouté à la main via `.eq('user_id', userId)`.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` n'est JAMAIS importé ni référencé dans un fichier `components/**` ou `app/**` côté client (`'use client'`).
- [ ] Aucune query ne fait confiance à un `user_id` qui vient du body / query string sans recouper avec la session.

### Validation des entrées
- [ ] Toute route API parse son body / query string avec un schéma Zod avant de toucher la BDD.
- [ ] Les `.transform()` Zod renvoient un type prévisible — pas de coercion sauvage.
- [ ] Les enums (`ProspectStatus`, `Priority`, etc.) sont en sync entre `lib/types.ts`, Zod schemas et la migration SQL (`CHECK` ou `ENUM` type).

### Pipeline agent
- [ ] Les changements dans `lib/agent/orchestrator.ts` préservent l'ordre : sourcing → enrichissement BEGES → scoring composite → enrichissement contact → scoring Gemini → sélection top → email.
- [ ] Le prompt Gemini dans `lib/agent/gemini-scoring.ts` respecte l'ordre obligatoire des raisons ROI → image → légal et le schéma `{ interet_score, raisons }`. Si modifié, il est mentionné dans `memory/prompt-history.md`.
- [ ] Pas de TODO sans ticket ou commentaire d'explication.

### Robustesse
- [ ] Les appels HTTP externes (INSEE, ADEME, Pappers, Hunter, Gemini, Resend) ont un timeout et un retry/fallback documenté.
- [ ] Les erreurs sont catchées et loggées de façon structurée (JSON pour l'orchestrateur). Pas de `console.log` brut qui leak des secrets ou PII.
- [ ] Sentry capture les erreurs critiques mais ne logge ni `service_role`, ni emails clients, ni numéros SIREN/SIRET sans nécessité.

## 3. Format de retour

Pour chaque fichier, sortie en français :

```
## <chemin/du/fichier.ts>

Bloquants (à corriger avant merge) :
- ...

À améliorer (non bloquant) :
- ...

Bien vu :
- ...
```

Verdict final : `Approuvé` / `Changements demandés` / `Refactor majeur requis`. Applique le filtre : un staff engineer approuverait-il en l'état ?
