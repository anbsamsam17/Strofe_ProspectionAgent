# APIs externes

Toutes les intégrations sortantes du pipeline. Variables d'env à configurer dans `.env.local` (dev) et Vercel project settings (prod).

## Sirene INSEE v3.11 (sourcing primaire, depuis sept. 2025)

> Migration majeure de sept. 2025 : l'INSEE a **abandonné OAuth2** au profit d'une API Key simple par header. Les anciennes vars `INSEE_CLIENT_ID` / `INSEE_CLIENT_SECRET` sont mortes. Cf. hindsight `2026-04-06 — INSEE API : migration OAuth2 → API Key`.

### Identité de l'endpoint

- **URL base** : `https://api.insee.fr/api-sirene/3.11/siret` (cf. `lib/agent/sourcing.ts`, constante `INSEE_SIRET_URL`).
- **Doc officielle** : https://www.sirene.fr/sirene/public/static/api-sirene
- **Portail développeur** (génération clé + gestion plans) : https://portail-api.insee.fr/ → Applications → ton app → API Keys.
- **Attention vocabulaire** : `portail-api.insee.fr` = UI de gestion, **pas** l'API. L'API est sur `api.insee.fr`.

### Authentification (depuis 2025-09)

- **Header attendu** : `X-INSEE-Api-Key-Integration: <key>` (plan gratuit "Intégration") **ou** `X-INSEE-Api-Key-Production: <key>` (plan payant "Production").
- **Variables d'env** : `INSEE_API_KEY` (unique clé, plus de paire client_id/client_secret). Helper `getInseeApiKey()` dans `lib/agent/sourcing.ts` lignes 432-448.
- **Plans disponibles** :
  - **Intégration** — gratuit, destiné au développement. Clé à émettre sur le portail, header `X-INSEE-Api-Key-Integration`.
  - **Production** — payant ou sur demande motivée. Header `X-INSEE-Api-Key-Production`. Quotas relevés.
- **Précondition CRITIQUE** : l'app sur portail-api.insee.fr doit être explicitement **abonnée à l'API Sirene** (onglet APIs → Subscribe → Sirene). Une clé valide mais non abonnée Sirene retourne 401/403 silencieux.

### Quotas et rate limits (plan Intégration gratuit, valeurs à confirmer sur le portail)

- **30 requêtes / minute** — `SIRENE_DELAY_MS = 2100 ms` entre les pages dans le code (~28 req/min, marge de sécurité).
- **500 requêtes / jour** indicatif sur plan gratuit (vérifier sur le dashboard portail-api après quelques runs réels). Au-delà : HTTP 429 ou throttle silencieux.
- **Production** : limites relevées sur demande.

### Format de query Solr (anti-bug HTTP 400)

L'API Sirene v3.11 utilise un parser **Solr / Lucene** pour le paramètre `q=`. Règles critiques :

1. **Codes NAF** : 5 caractères alphanumériques `LLNNF` (sans point, ex. `0121Z`, `49.41A` → `4941A`). Voir `normalizeNafCodes()` dans `sourcing.ts:545-564`.
2. **Quoting OBLIGATOIRE des valeurs string** : `activitePrincipaleEtablissement:("0121Z" OR "0122Z")`. Sans guillemets, Solr interprète les tokens commençant par chiffre comme expressions numériques → **HTTP 400 "Erreur de syntaxe dans le paramètre q"**. Voir `buildLuceneQuery()` dans `sourcing.ts:642-684`.
3. **Pas de clause vide `champ:()`** : tous les filtres sont conditionnels (cf. hindsight 2026-04-06).
4. **Invariant always-present** : `etatAdministratifEtablissement:"A"` (anti-`q=` vide).
5. **Chunking NAF** : Solr Sirene refuse > ~25 termes par OR. Constante `SIRENE_MAX_NAF_PER_QUERY = 20` dans `sourcing.ts:102`. Au-delà, chunking transparent via curseur composite `chunk:<index>|<rawCursor>`.

### Pagination par CURSEUR (Wave 2, v3.11)

- Premier appel : `curseur=*` (URLSearchParams encode `*` → `%2A`).
- Pages suivantes : passer `header.curseurSuivant` reçu en `curseur` du prochain appel.
- Fin d'univers : `curseurSuivant === curseur` (page terminale).
- Curseur composite multi-chunks : `chunk:0|*` → `chunk:0|abc123` → ... → `chunk:1|*` → ... Voir `parseCompositeCursor` / `serializeCompositeCursor` dans `sourcing.ts:596-623`. **Important** : le `|` du curseur composite ne va JAMAIS dans le param `q=` — il est uniquement dans le param `curseur=`.
- L'ancien mode offset `debut=N` est abandonné.

### API exposée

- `sourcerEntreprises(params: SourcerEntreprisesParams): Promise<SourcerEntreprisesResult>`. Types exportés depuis `lib/agent/sourcing.ts` :
  - `SourcerEntreprisesParams` — `nafCodes`, `effectifTranches`, `codePostalRange`, `departements`, `curseur`, `pageSize`, `maxPages`, `excludeSirens` (toutes optionnelles avec défauts legacy : Gironde, 50+ salariés, NAF prioritaires).
  - `SourcerEntreprisesResult` — `etablissements`, `curseur`, `curseurSuivant`, `totalAvailable`, `pagesLoaded`, `exhausted`.
  - `SireneApiError` — sur HTTP 5xx persistant ou parse JSON échoué. Le caller doit l'attraper pour basculer en fallback.
  - `SireneValidationError` — sur params invalides (tranche inconnue, codePostalRange mal formé, maxPages ≤ 0).
  - `AdemeBegesDataFairRecord` — type record ADEME (auparavant interne, désormais exporté ; les fixtures `fixtures/ademe.ts` ne sont plus un mirror).
- **Header type** : `SireneHeader` (dans `lib/types.ts`) inclut désormais `curseur?` et `curseurSuivant?` ; `debut` / `nombre` legacy sont optionnels.
- **Utilisation** : recherche d'établissements par codes NAF + tranches d'effectif + range code postal. Filtrage post-fetch `excludeSirens` (l'API Sirene ne supporte pas NOT IN — dedup côté code).
- **Logging** : chaque page fetchée émet un log JSON structuré `{ phase: 'sirene_page', page, curseur, curseurSuivant, returned, header_total }` + un log diag `sirene_query_diag` avec la query exacte (cf. `sourcing.ts:758-773`).
- **Fallback** : si exception (`SireneApiError`) ou 0 résultats → Recherche Entreprises gouv (ci-dessous). Sur 4xx (auth/validation), `sourcerEntreprises` renvoie un résultat vide avec `exhausted=true` pour permettre la bascule fallback sans throw.

### Troubleshooting HTTP 400 "Erreur de syntaxe dans le paramètre q"

Hypothèses classées par fréquence observée (session debug 2026-05-17) :

1. **Token NAF non-quoté** — le piège n°1 de v3.11.
   - `activitePrincipaleEtablissement:(0121Z OR 0122Z)` → **HTTP 400**. Solr interprète `0121Z` comme expression numérique.
   - Fix : quoter chaque valeur. `activitePrincipaleEtablissement:("0121Z" OR "0122Z")` → **HTTP 200**.
   - Implémentation : `buildLuceneQuery()` dans `sourcing.ts:678-681` génère systématiquement les guillemets.
2. **Filtre vide `champ:()`** — si `nafCodes=[]`, `effectifTranches=[]` ou `codePostalRange=['','']`, NE PAS générer la clause. Cf. `buildLuceneQuery()` (toutes les clauses sont conditionnelles, fallback sur `etatAdministratifEtablissement:"A"`).
3. **Mauvais header pour le plan de la clé** — clé "Production" envoyée sur header "Integration" (ou l'inverse) → 401 ou 400 selon la version Gravitee. Vérifier le plan rattaché à la clé sur portail-api.insee.fr.
4. **API Sirene non abonnée sur l'app INSEE** — clé valide mais l'app n'a pas souscrit à l'API Sirene → 401/403. Aller sur portail-api.insee.fr → ton app → APIs → Subscribe à Sirene.
5. **Curseur composite `chunk:0|*` dans `q=`** au lieu de `?curseur=` — le `|` casse la query Solr. Doit être strictement dans le param séparé `curseur=`. Toujours via `url.searchParams.set('curseur', ...)`, jamais concaténé dans `q=`.
6. **Caractères Solr réservés non escapés** dans une valeur — `+ - && || ! ( ) { } [ ] ^ " ~ * ? : \ /` + espace. `normalizeNafCodes()` filtre ces caractères en amont (cf. `sourcing.ts:531`).
7. **Query trop longue** — au-delà de ~8 KB l'URL peut être tronquée par la gateway Gravitee. Constante `SIRENE_MAX_NAF_PER_QUERY = 20` borne le risque ; chunking automatique au-delà.

### Scripts de test

- **`scripts/test-insee-sirene.ps1`** — test minimal d'une `INSEE_API_KEY` contre l'endpoint v3.11 (1 requête, NAF unique, Gironde). Sortie : HTTP status + nb résultats. À lancer après chaque rotation de clé.
- **`scripts/test-sirene-queries.ps1`** — bench de 14 variantes de query Lucene (quoting, ranges, OR multiples, codes NAF mixtes, etc.) pour identifier précisément ce qui passe et ce qui retourne 400. Utilisé lors de la session debug 2026-05-17.

### Bulk SIRENE — sourcing primaire depuis 2026-05-17 (Plan C en prod)

L'API Sirene live INSEE étant chroniquement instable (HTTP 400 Solr, quotas, OAuth2 → API Key sept. 2025), le sourcing est passé sur un cache local rafraîchi mensuellement par GitHub Actions. Détails complets : [sirene-bulk-cron.md](./sirene-bulk-cron.md).

- **Source** : `https://www.data.gouv.fr/api/1/datasets/base-sirene-des-entreprises-et-de-leurs-etablissements-siren-siret/` → résolution dynamique de la resource `StockEtablissement_utf8` (l'id change chaque mois).
- **Backend storage** : `object.files.data.gouv.fr/data-pipeline-open/siren/stock/StockEtablissement_utf8.zip` (~1.1 GB ZIP, ~3 GB décompressé, 43M lignes).
- **Cadence** : cron mensuel GH Actions le 1er du mois 04:00 UTC. Trigger manuel via `gh workflow run sirene-import.yml -f force=true`.
- **Table cible** : `sirene_cache` (~11k lignes, ~4 MB après filtre BEGES).
- **Trade-off** : pas de fraîcheur intra-mois sur créations/cessations, mais 0 dépendance API, 0 clé, 0 quota.
- **Lecture côté app** : `lib/agent/sirene-cache.ts` → `searchSireneCache()` (fonction PL/pgSQL avec index composite).
- **Whitelist SSRF à maintenir** : `www.data.gouv.fr` ET `object.files.data.gouv.fr`.

## Recherche Entreprises (data.gouv.fr) — fallback gratuit

- **URL base** : `https://recherche-entreprises.api.gouv.fr/search`
- **Doc officielle** : https://api.gouv.fr/les-api/api-recherche-entreprises
- **Auth** : aucune (open data, miroir SIRENE indexé différemment).
- **Rate limit** : **7 req/sec** documenté, illimité en volume quotidien.
- **Couverture** : ~95 % des entreprises FR (miroir SIRENE re-indexé). Manque parfois les très récentes (≤ 7 jours) et les modifications administratives intra-mois.
- **Format NAF** : avec point (`49.41A`), contrairement à Sirene qui utilise sans point (`4941A`). Cf. hindsight 2026-04-06 — Fallback sourcing.
- **Utilisation** : **filet de sécurité** déclenché par la boucle adaptative à la 1ère page si Sirene throw `SireneApiError` (cf. `lib/agent/sourcing-runner.ts:473-494`). Un seul appel (pas de curseur) → l'univers est marqué `exhausted=true` après. `excludeSirens` passé pour skip les SIREN déjà connus de l'user.
- **Variables d'env** : aucune.
- **Recommandation projet (2026-05-17)** : activer le fallback en mode **prioritaire** (sans tenter Sirene en amont) si Sirene est KO sur **> 3 runs consécutifs**. La métrique de santé est calculée dans `lib/observability/sirene-health.ts` (compteur d'échecs successifs sur les N derniers `agent_runs`). Au-delà du seuil, l'orchestrator route directement vers Recherche Entreprises pour éviter les 2s de timeout Sirene × N pages × N users.

## ADEME BEGES (enrichissement)

- **URL base** : `https://data.ademe.fr/data-fair/api/v1/datasets/bilans-ges/lines` (à vérifier).
- **Auth** : aucune. Open data Data Fair.
- **Rate limit** : pas de limite documentée publiquement. L'orchestrator parallélise en **batches de 20** (`ADEME_BATCH_SIZE`).
- **Utilisation** : pour chaque SIREN sourcé, on cherche le dernier BEGES publié → renseigne `beges_publie`, `beges_derniere_publication`, `beges_url`, `beges_valide` (<= 4 ans).
- **Variables d'env** : aucune.

## Pappers (enrichissement contact)

- **URL base** : `https://api.pappers.fr/v2/` (à vérifier).
- **Auth** : API key dans query param ou header.
- **Variables d'env** : `PAPPERS_API_KEY`.
- **Coût** : freemium. Crédits limités → l'orchestrator appelle séquentiellement et **max 10 prospects/run** (top score>70 sans contact).
- **Utilisation** : dirigeants (nom, prénom, poste) + parfois téléphone.
- **Fallback** : si manquant ou en échec → Hunter.io. Si la clé est absente, phase 4.5 est skippée silencieusement.

## Hunter.io (enrichissement email)

- **URL base** : `https://api.hunter.io/v2/`.
- **Auth** : `?api_key=...`.
- **Variables d'env** : `HUNTER_API_KEY`.
- **Coût** : freemium 25 recherches/mois. Au-delà : payant. L'orchestrator track les crédits utilisés via `getCreditsUsed()` (`contact-enrichment.ts`).
- **Endpoints utilisés** :
  - **domain-search** : trouve les patterns d'emails d'un domaine.
  - **email-finder** : `{first_name, last_name, domain}` → email vérifié.
- **Cascade** : domain-search d'abord (déduit le pattern), puis email-finder par dirigeant trouvé via Pappers.

## Google Gemini (scoring commercial + catégorisation secteur)

- **Endpoint** : `https://generativelanguage.googleapis.com/` (via SDK officiel `@google/generative-ai`).
- **Auth** : API key (`GEMINI_API_KEY`), gérée par le SDK.
- **Variables d'env** : `GEMINI_API_KEY` (optionnelle — sans elle, la phase de scoring commercial est skippée proprement via `isGeminiAvailable()`).
- **Modèle** : `gemini-2.0-flash` (constante `GEMINI_MODEL` dans `lib/agent/gemini-scoring.ts`).
- **Usage** :
  - **Scoring commercial** (`scoreLeadsBatchGemini`) : pour chaque prospect enrichi, intérêt 0-100 + 3-5 raisons d'appel → persistés dans `prospects` (`gemini_interet_score`, `gemini_raisons`, `gemini_generated_at`).
  - **Catégorisation secteur** (`categoriserSecteurAvecGemini`) : complète `prospects.secteur_libelle` quand vide. Cache LRU 1h + throttle 50 ms.
- **Rate limit** : Gemini 2.0 Flash ~1000 RPM (Tier 1), 30 req/min sur le quota gratuit. L'orchestrator parallélise par groupes de **5** (`GEMINI_PARALLEL_GROUP_SIZE`) avec délai **200 ms** (`GEMINI_BATCH_DELAY_MS`) entre groupes.
- **Timeout / retries** : `GEMINI_TIMEOUT_MS = 15_000` (scoring) / `8_000` (catégorisation), `GEMINI_MAX_RETRIES = 1` sur erreur retriable (429 / 5xx / timeout).
- **Format de sortie** : structured output natif (`responseSchema`) + re-validation Zod — voir `prompts-guide.md`.
- **Échec transitoire vs définitif** : sur échec transitoire le résultat porte `transient_failure: true` ; le caller laisse alors `gemini_generated_at` NULL pour re-tenter au prochain run.

## Resend (emails transactionnels)

- **URL base** : `https://api.resend.com/`.
- **Auth** : API key.
- **Variables d'env** : `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (à vérifier).
- **Usage** : `/api/notifications/daily` envoie un email récapitulatif des nouveaux prospects sourcés / qualifiés à `profiles.settings.notification_email` (fallback `profiles.email`). Templates React Email dans `lib/email/`.
- **Quota** : 3 000 emails/mois gratuit, suffisant pour la beta.
- **Garde-fou** : un garde anti-double-envoi (idempotence) protège contre les retries Vercel sur la même journée.

## Supabase (base + auth)

- **URL** : `NEXT_PUBLIC_SUPABASE_URL`.
- **Clés** :
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — client navigateur + middleware SSR.
  - `SUPABASE_SERVICE_ROLE_KEY` — orchestrator uniquement, bypass RLS.
- **SDK** : `@supabase/ssr` (cookies SSR) + `@supabase/supabase-js`. Helpers dans `lib/supabase/server.ts` (`createClient`, `createAdminClient`).

## Sentry

- **URL** : `NEXT_PUBLIC_SENTRY_DSN`.
- **Config** : `sentry.client.config.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts`.
- **PII scrub** : `beforeSend` doit retirer les emails/téléphones de prospects (cf. `security.md`).

## Récap variables d'env

```dotenv
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Google Gemini (scoring commercial + catégorisation secteur — optionnel, phase skippée sans)
GEMINI_API_KEY=

# Sirene INSEE (API Key depuis sept. 2025 — anciennes vars OAuth2 INSEE_CLIENT_ID/SECRET mortes)
# Génération : https://portail-api.insee.fr/ → Applications → ton app → API Keys
# Plan "Intégration" (gratuit) → header X-INSEE-Api-Key-Integration côté code
INSEE_API_KEY=

# Enrichissement contacts (optionnels — phase 4.5 skippée sans)
PAPPERS_API_KEY=
HUNTER_API_KEY=

# Emails
RESEND_API_KEY=
RESEND_FROM_EMAIL=

# Cron
CRON_SECRET=

# Sentry
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=        # build uploads sourcemaps
```

## Fixtures de test

Pour mocker les APIs externes sans appel réseau réel, des fixtures TypeScript prêtes à l'emploi sont disponibles dans `lib/agent/__tests__/fixtures/` (barrel `index.ts`).

**`fixtures/sirene-cursor.ts`** — pagination curseur INSEE (Wave 2 cible) :
- `sireneSampleEtablissement(siren, opts?)` — factory d'un `SireneEtablissement` réaliste (NAF prioritaire, CP Gironde).
- `buildSirenePage({ curseur, curseurSuivant, count, sirenStart?, total?, debut? })` — page Sirene paramétrable.
- `sireneCursorSequence` — séquence `{ page1, page2, page3 }` avec curseurs progressant (`*` → `c2` → `c3` → `c3` = FIN). 250 SIREN uniques (100000000..100000249).
- `sireneEmptyResponse` — page vide (univers sans résultat).
- `sireneErrorResponse` — enveloppe HTTP 500 pour tester le mode dégradé.
- Types locaux exportés : `SireneCursorHeader`, `SireneCursorResponse`. **Wave 2.1 mergé** : `SireneHeader` dans `lib/types.ts` inclut désormais `curseur?` et `curseurSuivant?` — `SireneCursorHeader` peut être considéré comme assignable à `SireneHeader` (les fixtures restent valides).

**`fixtures/ademe.ts`** — réponses ADEME Data Fair `/bilan-ges/lines` :
- `buildAdemeResponse({ siren, hasBeges, begesDate?, begesValide?, raisonSociale? })` — builder custom.
- `ademeWithBegesValide` — bilan publié récent (annee_de_reporting = currentYear − 1).
- `ademeWithBegesExpire` — bilan présent mais > 4 ans (flag `beges_valide=false`).
- `ademeWithoutBeges` — pas de bilan (cible prospection la plus pertinente).
- `ademeErrorResponse` — enveloppe HTTP 503.
- Type local exporté : `AdemeBegesDataFairRecord`. **Wave 2.1 mergé** : ce type est désormais exporté depuis `lib/agent/sourcing.ts` ; les fixtures et `sourcing.ts` partagent la même définition (plus de mirror).

Toutes les fixtures sont **100 % statiques** (aucun `fetch`/`axios`), typées strictement (pas de `any`), et sans dépendance circulaire (n'importent que depuis `@/lib/types`).

## Pattern fallback général

Quand une API tombe :
1. Log warn dans `agent_runs.logs` avec le SIREN ou batch concerné.
2. Si fallback existe (Sirene → Recherche Entreprises) → bascule.
3. Sinon → la phase non-fatale (`scoring commercial Gemini`, `contact_enrichment`) continue sans cette donnée ; la phase fatale (`sourcing`, upsert `prospects`) propage l'erreur → `agent_runs.status='failed'`.
