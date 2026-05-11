# APIs externes

Toutes les intégrations sortantes du pipeline. Variables d'env à configurer dans `.env.local` (dev) et Vercel project settings (prod).

## Sirene INSEE (sourcing primaire)

- **URL base** : `https://api.insee.fr/api-sirene/3.11/siret` (cf. `lib/agent/sourcing.ts`, constante `INSEE_SIRET_URL`).
- **Auth** : **API Key simple** (depuis sept. 2025, l'INSEE a abandonné OAuth2). Header `X-INSEE-Api-Key-Integration: <key>`. Clé générée sur https://portail-api.insee.fr/ → Applications → API Key.
- **Variables d'env** : `INSEE_API_KEY` (anciennes `INSEE_CLIENT_ID` / `INSEE_CLIENT_SECRET` mortes).
- **Rate limit** : ~30 req/min. `SIRENE_DELAY_MS = 2100 ms` entre les pages (~28 req/min, marge de sécurité).
- **Pagination** : **CURSEUR officiel INSEE v3.11** (Wave 2). Premier appel `curseur=*`, pages suivantes utilisent `header.curseurSuivant`, fin d'univers détectée par `curseurSuivant === curseur` (page terminale). L'ancien mode offset `debut=N` est abandonné.
- **API exposée** : `sourcerEntreprises(params: SourcerEntreprisesParams): Promise<SourcerEntreprisesResult>`. Types exportés depuis `lib/agent/sourcing.ts` :
  - `SourcerEntreprisesParams` — `nafCodes`, `effectifTranches`, `codePostalRange`, `departements`, `curseur`, `pageSize`, `maxPages`, `excludeSirens` (toutes optionnelles avec défauts legacy : Gironde, 50+ salariés, NAF prioritaires).
  - `SourcerEntreprisesResult` — `etablissements`, `curseur`, `curseurSuivant`, `totalAvailable`, `pagesLoaded`, `exhausted`.
  - `SireneApiError` — sur HTTP 5xx persistant ou parse JSON échoué. Le caller doit l'attraper pour basculer en fallback.
  - `SireneValidationError` — sur params invalides (tranche inconnue, codePostalRange mal formé, maxPages ≤ 0).
  - `AdemeBegesDataFairRecord` — type record ADEME (auparavant interne, désormais exporté ; les fixtures `fixtures/ademe.ts` ne sont plus un mirror).
- **Header type** : `SireneHeader` (dans `lib/types.ts`) inclut désormais `curseur?` et `curseurSuivant?` ; `debut` / `nombre` legacy sont optionnels.
- **Utilisation** : recherche d'établissements par codes NAF + tranches d'effectif + range code postal. Filtrage post-fetch `excludeSirens` (l'API Sirene ne supporte pas NOT IN — dedup côté code).
- **Logging** : chaque page fetchée émet un log JSON structuré `{ phase: 'sirene_page', page, curseur, curseurSuivant, returned, header_total }`.
- **Fallback** : si exception (`SireneApiError`) ou 0 résultats → Recherche Entreprises gouv (ci-dessous). Sur 4xx (auth/validation), `sourcerEntreprises` renvoie un résultat vide avec `exhausted=true` pour permettre la bascule fallback sans throw.

## Recherche Entreprises (data.gouv.fr) — fallback gratuit

- **URL base** : `https://recherche-entreprises.api.gouv.fr/search` (à confirmer dans le code).
- **Auth** : aucune. Open data.
- **Rate limit** : ~7 req/s documenté, illimité en volume quotidien.
- **Utilisation** : **filet de sécurité** déclenché par la boucle adaptative à la 1ère page si Sirene throw `SireneApiError` (cf. `lib/agent/sourcing-runner.ts:473-494`). Un seul appel (pas de curseur) → l'univers est marqué `exhausted=true` après. `excludeSirens` passé pour skip les SIREN déjà connus de l'user.
- **Variables d'env** : aucune.

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

## OpenAI (GPT-4o pour pitchs)

- **URL base** : `https://api.openai.com/v1/` (via SDK officiel `openai` ^4.89).
- **Auth** : `Authorization: Bearer <key>`.
- **Variables d'env** : `OPENAI_API_KEY`.
- **Modèle** : `gpt-4o` (constante `GPT_MODEL` dans `lib/agent/pitch-gen.ts`).
- **Rate limit** : RPM tier standard ~500. L'orchestrator parallélise par groupes de **5** (`PARALLEL_GROUP_SIZE`) avec délai **150 ms** (`BATCH_DELAY_MS`) entre groupes.
- **Timeout / retries** : `timeout: 30_000`, `maxRetries: 2` (config client OpenAI).
- **Format de sortie** : JSON structuré — voir `prompts-guide.md`.

## Resend (emails transactionnels)

- **URL base** : `https://api.resend.com/`.
- **Auth** : API key.
- **Variables d'env** : `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (à vérifier).
- **Usage** : `/api/notifications/daily` envoie un email "votre liste de 15 appels est prête" à `profiles.settings.notification_email` (fallback `profiles.email`). Templates React Email dans `lib/email/`.
- **Quota** : 3 000 emails/mois gratuit, suffisant pour la beta.
- **Garde-fou** : `daily_lists.notified_at` IS NULL → envoie ; sinon skip (évite double envoi sur Vercel retry).

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

# OpenAI
OPENAI_API_KEY=

# Sirene INSEE (API Key depuis sept. 2025 — anciennes vars OAuth2 mortes)
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
3. Sinon → la phase non-fatale (`scoring`, `contact_enrichment`) continue sans cette donnée ; la phase fatale (`sourcing`, `selection`, `daily_list`) propage l'erreur → `agent_runs.status='failed'`.
