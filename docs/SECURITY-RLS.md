# Isolation multi-tenant et RLS — ProspectionAgent

> Document de référence sur le modèle d'isolation des données du SaaS ProspectionAgent (Glan / Strofe).
> Décrit l'architecture Row Level Security (RLS) Supabase, l'isolation du `service_role`, et un signalement backlog de durcissement.

---

## 1. Vue d'ensemble

ProspectionAgent est un SaaS multi-tenant : chaque cabinet de conseil (utilisateur) ne doit voir et manipuler que **ses propres** prospects, listes d'appel, runs d'agent et profil. L'isolation repose sur deux mécanismes complémentaires, appliqués au niveau de la base de données PostgreSQL (Supabase) :

1. **RLS (Row Level Security)** — filtrage par ligne via `auth.uid() = user_id`, appliqué pour chaque requête de session utilisateur.
2. **Double barrière d'unicité** — contrainte `UNIQUE(user_id, siren)` qui empêche les doublons par tenant et garantit qu'un même SIREN appartient logiquement à un seul user à la fois.

Le filtrage est délégué entièrement à PostgreSQL : l'application **ne re-filtre jamais** manuellement par `user_id` côté code (anti-pattern qui masquerait une RLS cassée). C'est la session Supabase SSR (cookie → JWT → `auth.uid()`) couplée aux policies RLS qui assure l'isolation.

---

## 2. RLS — 4 policies par table (`auth.uid() = user_id`)

Référence : `supabase/migrations/001_initial.sql`.

Chaque table métier a la RLS **activée** (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) et expose exactement **4 policies** — une par opération :

| Opération | Clause |
|-----------|--------|
| `SELECT`  | `USING (auth.uid() = user_id)` |
| `INSERT`  | `WITH CHECK (auth.uid() = user_id)` |
| `UPDATE`  | `USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)` |
| `DELETE`  | `USING (auth.uid() = user_id)` |

Pour la table `profiles`, la colonne pivot est `id` (la PK qui référence `auth.users(id)`) au lieu de `user_id`, mais le principe est identique : `auth.uid() = id`.

> **Alignement 029** — `domain_blacklist` (migration 021) était la seule table dont la
> policy `UPDATE` déviait du standard : elle ne déclarait qu'une clause `USING` sans
> `WITH CHECK`, ce qui filtrait les lignes modifiables mais n'empêchait pas de
> réaffecter une ligne à un autre `user_id` lors de l'UPDATE. La migration
> `029_domain_blacklist_update_with_check.sql` recrée la policy à l'identique en
> ajoutant `WITH CHECK (auth.uid() = user_id)`, réalignant la table sur le standard
> 4-policies. Référence : `029_domain_blacklist_update_with_check.sql:42-47`.

### Tables protégées

Tables **actuellement en production** avec RLS `auth.uid() = user_id` (4 policies) :

- `profiles` (pivot `id`) — `001_initial.sql:98`
- `prospects` — `001_initial.sql:324`
- `agent_runs` — `001_initial.sql:695`
- `prospect_contacts` (contient la **PII dirigeant**, donc RLS stricte indispensable) — `011_prospect_contacts.sql:87`
- `prospect_exchanges` — `012_prospect_exchanges.sql:88`
- `api_quotas` (quotas API mensuels par user/provider) — `015_enrichment_v2.sql:201`
- `opt_out` (opt-out RGPD par SIREN ou email) — `015_enrichment_v2.sql:262`
- `domain_blacklist` (blacklist domaines par tenant) — `021_domain_blacklist.sql:47`

Plus une table en lecture publique mutualisée :

- `sirene_cache` — RLS activée mais `SELECT USING (true)` (données publiques INSEE, sans PII), aucune policy d'écriture — `018_sirene_cache.sql:137,142-144` (cf. §4).

> Tables historiques supprimées en 014 : `daily_lists` et `daily_list_items`
> portaient elles aussi 4 policies (avec `user_id` **dénormalisé** sur
> `daily_list_items` pour une RLS sans jointure coûteuse vers `daily_lists`).
> Elles ont été supprimées au pivot « plus de daily list » et ne sont plus en base.

### Pourquoi `auth.uid()`

`auth.uid()` extrait l'UUID de l'utilisateur depuis le JWT de la session Supabase courante. Une requête sans session valide (ou avec la session d'un autre user) ne peut ni lire ni écrire les lignes d'un tenant tiers : PostgreSQL filtre la ligne avant même qu'elle n'atteigne l'application.

> Règle non négociable (cf. `.claude/rules/security.md`) : **ne jamais** ajouter de `.eq('user_id', userId)` manuel dans une route API authentifiée pour « double-vérifier ». Ce serait un code smell masquant une éventuelle RLS défaillante. La RLS est la seule barrière, et elle doit suffire.

---

## 3. Double barrière d'unicité — `UNIQUE(user_id, siren)`

La table `prospects` porte la contrainte :

```sql
CONSTRAINT uq_prospects_user_siren UNIQUE (user_id, siren)
```

Effets :

- **Isolation logique** : la clé d'unicité est le **couple** `(user_id, siren)`, pas le SIREN seul. Deux tenants distincts peuvent donc avoir le même SIREN en base sans collision — chacun dans son périmètre.
- **Déduplication par tenant** : un même SIREN ne peut apparaître qu'une seule fois pour un user donné. Le sourcing nocturne s'appuie sur cette contrainte (et sur l'exclusion des SIREN déjà connus côté `search_sirene_cache`) pour ne pas re-proposer une entreprise déjà présente dans le pipeline du tenant.

Cette contrainte agit comme « seconde barrière » : même si une erreur applicative tentait d'insérer un doublon inter ou intra-tenant, la base le refuse au niveau intégrité, indépendamment de la RLS.

---

## 4. Exception : lecture publique de `sirene_cache`

Référence : `supabase/migrations/018_sirene_cache.sql`.

La table `sirene_cache` est un **miroir local** d'un sous-ensemble du fichier bulk INSEE SIRENE (entreprises actives, 6+ salariés). C'est la **seule** exception au modèle `auth.uid() = user_id` :

- **Nature de la donnée** : données **publiques INSEE**, **sans PII**. Le contact dirigeant (nom, email, téléphone) n'est jamais stocké ici — il reste dans `prospect_contacts`, sous RLS stricte par tenant.
- **RLS** : activée, mais avec une policy `SELECT` ouverte (`USING (true)`) car le cache est **mutualisé** entre tous les tenants (tous interrogent le même référentiel d'entreprises).
- **Écriture** : **aucune** policy `INSERT` / `UPDATE` / `DELETE`. Seul le `service_role` peut écrire, ce qui correspond exclusivement au script ETL `scripts/import-sirene-bulk.ts` (réimport mensuel).

Justification : exposer en lecture des données déjà publiques (référentiel SIRENE) ne crée pas de risque de fuite de PII et évite de dupliquer ce cache lourd par tenant.

---

## 5. Isolation du `service_role` (admin client, serveur uniquement)

Référence : `lib/supabase/server.ts` (`createAdminClient`) et `lib/supabase/client.ts`.

Le `service_role` **bypass la RLS** — c'est une clé super-utilisateur. Son usage est donc strictement encadré :

- **Client navigateur** (`lib/supabase/client.ts`) : utilise uniquement la clé **anon** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`). Aucun accès au `service_role`.
- **Client serveur session** (`createClient` dans `server.ts`) : utilise aussi la clé **anon** + cookies SSR → la RLS s'applique normalement avec `auth.uid()`.
- **Client admin** (`createAdminClient` dans `server.ts`) : seul à utiliser `SUPABASE_SERVICE_ROLE_KEY`. Il est construit avec `@supabase/supabase-js` (pas `@supabase/ssr`), **sans cookies ni session** (`autoRefreshToken: false`, `persistSession: false`) — ce qui élimine tout risque de fuite de la clé vers les cookies du navigateur.

Périmètre d'usage autorisé du `service_role` (cf. `.claude/rules/security.md`) : **uniquement** les routes serveur du pipeline cron, typiquement `app/api/agent/` et `app/api/notifications/`. Aucun import depuis un composant `'use client'` ni un composant serveur de page.

Audit rapide :

```bash
grep -r "SERVICE_ROLE" app/ components/   # ne doit rien retourner hors app/api/agent et app/api/notifications
```

---

## 6. Signalement backlog — durcissement des GRANT `anon`

> Statut : **à traiter** (non bloquant). Données publiques, mais surface d'exposition à restreindre par principe de moindre privilège.

La migration `019_sirene_search_function.sql` accorde des privilèges au rôle **`anon`** (non authentifié) qui dépassent le besoin réel de l'application. Vérifié dans `supabase/migrations/019_sirene_search_function.sql` :

### 6.1 GRANT EXECUTE à `anon` sur `search_sirene_cache` (≈ lignes 185-188)

```sql
GRANT EXECUTE ON FUNCTION public.search_sirene_cache(
  TEXT[], TEXT[], TEXT, TEXT, TEXT[], INT, INT
) TO authenticated, anon, service_role;
```

- La fonction est `SECURITY DEFINER` (elle bypass la RLS de `sirene_cache`).
- Elle ne manipule que des données publiques et n'accepte que des filtres scalaires typés (pas d'injection possible).
- **Mais** l'application n'a aucune route `anon` qui appelle cette fonction : le `anon` n'est pas nécessaire ici.
- **Recommandation** : retirer `anon` du GRANT (conserver `authenticated, service_role`) afin qu'une fonction `SECURITY DEFINER` ne soit pas exécutable par un visiteur non authentifié.

### 6.2 GRANT SELECT à `anon` sur la vue `sirene_cache_size` (≈ ligne 214)

```sql
GRANT SELECT ON public.sirene_cache_size TO authenticated, anon;
```

- La vue expose des **métriques agrégées** (taille de stockage, nombre d'établissements actifs, date du dernier import, âge en jours). Pas de PII.
- Elle alimente les health-checks et l'admin dashboard — usages **authentifiés** uniquement.
- **Recommandation** : retirer `anon` du GRANT. Exposer la volumétrie interne et la fraîcheur des données à un visiteur anonyme n'apporte rien et constitue une fuite d'information opérationnelle inutile.

### Action proposée

Ajouter une migration de durcissement (ex. `029_restrict_anon_grants.sql`) :

```sql
REVOKE EXECUTE ON FUNCTION public.search_sirene_cache(
  TEXT[], TEXT[], TEXT, TEXT, TEXT[], INT, INT
) FROM anon;

REVOKE SELECT ON public.sirene_cache_size FROM anon;
```

Aucune régression attendue côté application (aucune route `anon` ne consomme ces objets). À valider en staging avant `db push`.

---

## 7. Récapitulatif

| Mécanisme | Périmètre | Référence |
|-----------|-----------|-----------|
| RLS 4 policies `auth.uid()=user_id` (**10 tables**) | `profiles`, `prospects`, `agent_runs`, `prospect_contacts`, `prospect_exchanges`, `api_quotas`, `opt_out`, `domain_blacklist` (8 user-scoped) + `sirene_cache` (lecture publique) + `daily_list_items` (historique, dénormalisée, supprimée en 014) | `001`, `011`, `012`, `015`, `021`, `018` |
| Alignement policy UPDATE (`WITH CHECK`) | `domain_blacklist` | `029_domain_blacklist_update_with_check.sql:42-47` |
| Double barrière `UNIQUE(user_id, siren)` | `prospects` | `001_initial.sql` |
| Exception lecture publique (sans PII) | `sirene_cache` | `018_sirene_cache.sql` |
| Isolation `service_role` (admin, serveur-only) | `createAdminClient` | `lib/supabase/server.ts` |
| **Backlog : restreindre GRANT `anon`** | `search_sirene_cache`, `sirene_cache_size` | `019_sirene_search_function.sql` |

### Optimisation future (non appliquée) — `(select auth.uid())` / InitPlan caching

> Statut : **piste d'optimisation non appliquée**. Aucun impact sécurité — purement
> performance. À considérer si le volume par tenant croît fortement.

Les policies actuelles utilisent `auth.uid() = user_id`. Postgres peut, selon le plan,
ré-évaluer `auth.uid()` **par ligne** scannée. Le pattern recommandé par Supabase est
d'envelopper l'appel dans un sous-`SELECT` :

```sql
-- au lieu de :  USING (auth.uid() = user_id)
-- on écrirait : USING ((select auth.uid()) = user_id)
```

Le planner traite alors `(select auth.uid())` comme un **InitPlan** : la fonction est
évaluée **une seule fois** par requête (résultat mis en cache) au lieu d'une fois par
ligne, ce qui réduit nettement le coût sur les gros scans filtrés par RLS. Le résultat
fonctionnel est strictement identique (même filtre, même isolation) — c'est pourquoi
cette réécriture peut être appliquée sans changement de comportement le moment venu.
Non appliquée à ce jour (volumes actuels modestes, 2 tenants).
