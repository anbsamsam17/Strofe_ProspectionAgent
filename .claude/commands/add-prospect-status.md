---
description: "Ajoute un nouveau statut au cycle CRM (migration + types + UI)."
argument-hint: "<nom_statut>"
---

# /add-prospect-status

Tu ajoutes le nouveau statut `$ARGUMENTS` au cycle de vie des prospects. Le statut doit être en `snake_case` (ex: `negotiation`, `lost`).

L'ordre des 4 modifications est **non négociable** — DB d'abord, puis types, puis UI.

## 1. Migration SQL — supabase/migrations/

Lance d'abord `/new-migration add_<nom_statut>_to_prospect_status`.

Le type est un ENUM Postgres (`public.prospect_status`) défini dans `supabase/migrations/001_initial.sql`. Pour l'étendre :

```sql
-- =============================================================================
-- Migration : <NNN>_add_<nom_statut>_to_prospect_status.sql
-- Description: Ajoute le statut '<nom_statut>' à l'ENUM prospect_status.
-- =============================================================================

-- Postgres permet d'ajouter une valeur à un ENUM existant.
-- IF NOT EXISTS rend la migration idempotente.
ALTER TYPE public.prospect_status ADD VALUE IF NOT EXISTS '<nom_statut>';

COMMENT ON TYPE public.prospect_status IS
  'Statut pipeline CRM : sourced → qualified → contacted → interested → rdv → converted, + rejected / on_hold / <nom_statut>';
```

Note : `ALTER TYPE ... ADD VALUE` doit être committé seul (Postgres ne permet pas d'utiliser la nouvelle valeur dans la même transaction). Ne mets RIEN d'autre dans cette migration.

Applique la migration en local + prod (via Supabase dashboard) avant de passer à l'étape 2.

## 2. Types TypeScript — lib/types.ts

Dans `lib/types.ts`, ajoute `'<nom_statut>'` à l'union `ProspectStatus` (actuellement lignes 9-17). Conserve l'ordre logique du pipeline :

```ts
export type ProspectStatus =
  | 'sourced'
  | 'qualified'
  | 'contacted'
  | 'interested'
  | 'rdv'
  | 'converted'
  | 'rejected'
  | 'on_hold'
  | '<nom_statut>'
```

Régénère `lib/supabase/database.types.ts` via `npx supabase gen types typescript --linked > lib/supabase/database.types.ts` pour que l'ENUM Postgres soit reflété côté types DB.

Mets aussi à jour la constante `PROSPECT_STATUTS` dans `app/api/prospects/route.ts` (~ligne 22) — sans cet ajout, le filtre `?statut=<nom_statut>` est rejeté par Zod.

## 3. Pipeline UI — components/pipeline/pipeline-client.tsx

La vue Kanban a 5 colonnes actuellement (sourced/qualified/contacted/interested/rdv/converted). Dans `components/pipeline/pipeline-client.tsx` :

1. Ajoute la nouvelle colonne dans le tableau des colonnes Kanban — choisis la position selon la logique métier (avant `converted` ou après `rdv` typiquement).
2. Ajoute un libellé français pour le statut (ex: `negotiation` → "En négociation").
3. Ajoute une couleur Tailwind v4 cohérente avec les autres statuts.
4. Vérifie que le drag-and-drop autorise les transitions logiques (pas de saut depuis `sourced` vers `converted` sans étape intermédiaire si c'est ta règle).

## 4. Liste quotidienne — components/daily-list/daily-list-client.tsx

Si le nouveau statut peut être assigné à un prospect APRÈS un appel (depuis la daily list) :

1. Ajoute l'option dans le menu de feedback de `components/daily-list/daily-list-client.tsx`.
2. Vérifie le mapping `CallResult` ↔ `ProspectStatus` — si tu introduis un nouveau `CallResult` lié, ajoute-le aussi dans `lib/types.ts` et dans `app/api/daily-list/[id]/feedback/route.ts`.
3. Sinon (statut purement Kanban, jamais assignable depuis un feedback d'appel) : ignore cette étape.

## 5. Validation

1. `npm run type-check` — zéro erreur (vérifie que tous les `switch` sur `ProspectStatus` sont exhaustifs).
2. `npm run lint`.
3. `npm run test` — les tests sur le scoring (`lib/agent/__tests__/scoring.test.ts`) passent.
4. Test manuel : crée un prospect, fais-le transiter par le nouveau statut, vérifie la persistance en base et l'affichage UI.
