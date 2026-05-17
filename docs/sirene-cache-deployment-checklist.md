# Checklist déploiement cache SIRENE

> Validation avant mise en production du cache SIRENE bulk.
> Cocher chaque case avant d'autoriser le merge sur `main` puis le déploiement.

---

## Pré-requis dev

- [ ] Migration `018_sirene_cache.sql` appliquée en local + prod
- [ ] Migration `019_sirene_search_function.sql` appliquée en local + prod
- [ ] **Conflit migrations 019 résolu** : il existe `019_sirene_cache_size.sql` ET `019_sirene_search_function.sql` — décider laquelle garder (la `_search_function` est plus complète et inclut la vue) et supprimer/renommer l'autre AVANT `db push`
- [ ] Types Supabase régénérés (`npx supabase gen types typescript --linked > lib/supabase/database.types.ts`)
- [ ] `npm install` (dépendances `csv-parse`, `unzipper`, `@types/unzipper` déjà présentes)
- [ ] Node 22.6+ disponible localement pour `--experimental-strip-types` (GH Actions utilise déjà Node 22)

## Tests

- [ ] `npm run type-check` OK (notamment après régénération des types)
- [ ] `npm run test` OK (baseline + nouveaux tests cache)
- [ ] `npm run lint` OK
- [ ] `npm run build` OK
- [ ] Tests d'intégration Sirene API existants toujours verts (`lib/agent/__tests__/sirene-integration.test.ts`)

## Secrets GitHub (Repo > Settings > Secrets and variables > Actions)

- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `CRON_SECRET` (réutiliser le secret Vercel pour cohérence)
- [ ] `APP_URL` (ex. `https://decarbonleads.strofe.fr`)

## Premier import

- [ ] `gh workflow run sirene-import.yml -f force=true`
- [ ] Vérifier dans GH Actions : status `completed` (succès)
- [ ] Vérifier durée < 45 min (timeout step ETL)
- [ ] Vérifier Supabase : `SELECT count(*) FROM sirene_cache WHERE etat_administratif = 'A'` > 50 000
- [ ] Vérifier Supabase : `SELECT * FROM sirene_cache_size` retourne taille < 100 MB
- [ ] Vérifier UI : Settings > widget "Cache SIRENE" affiche le count + freshness `fresh`

## Validation runtime

- [ ] Lancer un sourcing manuel depuis `/glan` (ou via cron de test)
- [ ] Vérifier logs : présence d'une entrée `phase=sourcing` mentionnant le cache (zéro appel API Sirene en chemin nominal)
- [ ] Vérifier que les prospects récupérés ont les bonnes données : `raison_sociale`, `activite_principale` (NAF format `XX.XXY`), `code_postal`, `effectif_min`/`max`
- [ ] Désactiver temporairement `INSEE_API_KEY` (env Vercel preview) → vérifier que le sourcing fonctionne toujours via le cache
- [ ] Réactiver `INSEE_API_KEY` après test

## Observabilité

- [ ] Alerte Sentry configurée si `days_since_import > 45` (à câbler ultérieurement si non fait)
- [ ] Logs ETL JSON visibles dans Actions tab (progression toutes les 10 000 rows)

## Rollback plan

- En cas de régression sourcing : remettre `searchSireneCache()` en fallback et `sourcerEntreprises()` (API Sirene) en primaire dans `lib/agent/sourcing-runner.ts`
- DROP table : `DROP TABLE IF EXISTS public.sirene_cache CASCADE;` (re-rejouer migrations 018 + 019)
