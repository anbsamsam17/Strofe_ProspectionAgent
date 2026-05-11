---
description: "Audit complet des policies RLS sur les 5 tables du projet."
---

# /check-rls

Tu audites les Row Level Security policies sur Supabase. Cible attendue : 5 tables (`profiles`, `prospects`, `daily_lists`, `daily_list_items`, `agent_runs`) avec 4 policies chacune (SELECT/INSERT/UPDATE/DELETE).

## 1. Récupération des policies

Exécute via le SQL editor Supabase :

```sql
-- Policies en place
SELECT tablename, policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;

-- RLS activé ?
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'prospects', 'daily_lists', 'daily_list_items', 'agent_runs');
```

## 2. Critères de validation

Pour chaque table, vérifie :

1. `rowsecurity = true` — sinon Critique (toute écriture admin bypass, anon peut lire).
2. **4 policies** présentes (1 par opération CRUD). Si une manque sans raison documentée : Critique.
3. **Clause USING / WITH CHECK** :
   - `profiles` → `auth.uid() = id`.
   - Toutes les autres → `auth.uid() = user_id`.
   - Toute clause `true` ou `auth.role() = 'authenticated'` sans filtre user : Critique.
4. **Roles ciblés** : `{authenticated}`. Une policy ouverte à `anon` sur une table métier : Critique.
5. **UPDATE policies** : doivent avoir USING **et** WITH CHECK (sinon vol de ligne possible).

## 3. Vérifications complémentaires

1. **Indexes sur `user_id`** — sinon RLS = full scan :

   ```sql
   SELECT tablename, indexname, indexdef
   FROM pg_indexes
   WHERE schemaname = 'public' AND indexdef LIKE '%user_id%';
   ```

2. **Triggers SECURITY DEFINER** — `set_updated_at()` et `handle_new_user()` (cf. `001_initial.sql`) doivent rester `SECURITY DEFINER` avec `SET search_path = public` (anti search_path hijack).
3. **GRANT trop permissifs** — aucun GRANT à `anon` en dehors des migrations.

## 4. Détection des bypass côté code

Grep `createAdminClient` dans `app/**` et `lib/**`. Pour chaque résultat :

1. Quelle route/fonction l'utilise ?
2. A-t-elle une auth manuelle (Bearer `CRON_SECRET` ou check `user.id`) ?
3. Filtre-t-elle `.eq('user_id', ...)` avant chaque SELECT/UPDATE/DELETE multi-tenant ?

Manquer l'un des 3 = Critique.

## 5. Rapport

```
## Audit RLS — <date>
### Tables avec RLS activé
- [x] profiles (4 policies)
- ...
### Anomalies
- Critique : ...
- Moyen : ...
### Bypass service_role
- <fichier>:<ligne> — <raison>
```

Si conforme : "Audit RLS conforme — 5/5 tables protégées, 20/20 policies, indexes user_id présents."
