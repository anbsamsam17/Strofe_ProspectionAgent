# Pipeline nocturne — flow complet

Le pipeline est orchestré par `lib/agent/orchestrator.ts` (`runAgentNocturne`), déclenché par le cron Vercel 22h sur `/api/agent/run`.

**MAJ Wave 2.2 (fix/sourcing-pagination, 2026-05-11)** : la phase sourcing est désormais **adaptative** avec pagination par curseur Sirene officielle, persistance dans `profiles.sourcing_state`, et signature de filtres pour invalider le curseur si l'univers change. Les anciennes phases 3 (sourcing+enrich) et 4 (scoring+upsert) ont été fusionnées dans une phase unique déléguée à `lib/agent/sourcing-runner.ts:runPipelineSourcing`.

## Diagramme texte

```
[Cron Vercel 22h]
    │  POST /api/agent/run  (Bearer CRON_SECRET)
    ▼
[route.ts]
    │  isCronRequest() timing-safe → mode cron
    │  Sélectionne tous les profiles onboarded=true
    │  Promise.allSettled(users)   ← parallèle, 1 client admin par user
    ▼
[orchestrator.runAgentNocturne(userId, supabaseAdmin)]
    │
    ├─ Phase 1  init               → INSERT agent_runs (status running)
    ├─ Phase 2  load_settings      → SELECT profiles.settings (NAF cibles, ville, daily_call_target)
    │
    ├─ Phase 3+4 phaseSourcingAdaptive → runPipelineSourcing (lib/agent/sourcing-runner.ts)
    │   │   ├─ resolveSourcingFilters       → tranches INSEE, range CP, départements, NAF, signature SHA-256
    │   │   ├─ LOAD profiles.sourcing_state → décider curseur initial :
    │   │   │      • signature ≠ stockée    → reset '*'
    │   │   │      • exhausted_at < 7 jours → reset '*'
    │   │   │      • sinon                  → resume state.curseurSuivant
    │   │   ├─ runAdaptiveSourcing          → boucle :
    │   │   │      fetch 1 page curseur Sirene (excludeSirens, pageSize=100, maxPages=1)
    │   │   │      dedup + push collected (mute sirenSet)
    │   │   │      stop si candidats >= max(daily_call_target × 3, 50)
    │   │   │            OU curseurSuivant === curseur (univers épuisé)
    │   │   │            OU HARD_CAP_PAGES=50 ou HARD_CAP_DURATION_MS=4 min
    │   │   │      mode dégradé : SireneApiError → sourcerEntreprisesFallback (1 appel)
    │   │   ├─ enrichirProspect ADEME       → batch 20 parallèle (Promise.allSettled)
    │   │   ├─ calculerScore + statut       → seuil qualified = 20
    │   │   ├─ UPSERT prospects             → batch 50 (onConflict user_id,siren)
    │   │   │      heuristique created_at===updated_at → prospects_new / prospects_updated
    │   │   └─ UPDATE profiles.sourcing_state → { curseur, filters_signature, last_total, exhausted_at, last_run_at }
    │   └─ remplit agent_runs : prospects_new/updated, sirene_total_available, sirene_pages_loaded, sirene_curseur_final
    │
    ├─ Phase 4.5 contact_enrichment → top 10 score>70 sans email/tel
    │                                  Pappers (dirigeants + tel) puis Hunter.io (emails)
    │                                  séquentiel pour préserver quotas
    ├─ Phase 5  selection          → top N (daily_call_target) :
    │                                  statut in (sourced, qualified)
    │                                  beges_publie=false OU beges_valide=false
    │                                  exclus = prospects déjà dans la daily_list du jour
    ├─ Phase 6  generation_pitch   → GPT-4o, groupes de 5 en parallèle, delay 150ms
    └─ Phase 7  construction_liste → UPSERT daily_lists (status generating)
                                     INSERT daily_list_items (mode append cumulatif, ordre décalé)
                                     UPDATE daily_lists status=ready
[fin]  status completed, completed_at, logs persistés
```

## Détail par phase

### 1. init
- **Input** : userId.
- **Action** : vérifie qu'aucun run n'est déjà `running` pour ce user (anti-concurrence), crée la ligne `agent_runs`.
- **Output** : objet `AgentRun` en mémoire (id, started_at, logs=[]).
- **Échec** : throw si run déjà en cours → 409 côté API.

### 2. load_settings
- Lit `profiles.settings` (JSONB) : `target_sectors`, `target_city`, `target_postal_codes`, `daily_call_target`, `notification_email`, `offer_description`.
- Échec fatal → run passe `failed`.

### 3+4. sourcing adaptatif + enrichissement + scoring + upsert (fusionnés Wave 2.2)
- **Input** : settings (et params UI pour le run manuel `/api/agent/sourcing`).
- **Délégation** : `lib/agent/orchestrator.ts:phaseSourcingAdaptive` → `lib/agent/sourcing-runner.ts:runPipelineSourcing` (factorisation propre, même code que le bouton UI manuel).
- **Résolution filtres** (`lib/agent/sourcing-runner.ts:resolveSourcingFilters`) :
  - Priorité NAF : `params.targetSectors` > `settings.target_sectors` > `NAF_PRIORITAIRES_DEFAULT` (41 codes). Validation regex `^\d{2}\.\d{2}[A-Z]$`.
  - `mapEffectifToTranches(min, max)` → codes tranche INSEE (chevauchement plage). Défaut legacy si absent : `[21..53]` = 50+ salariés.
  - `mapRegionToCodePostal(label)` → range CP `[min, max]`. Reconnaît "Gironde"/"33", "Nouvelle-Aquitaine", "Île-de-France", "France"/vide → range nationale. Fallback Gironde sur label non reconnu (+ log warn).
  - `mapRegionToDepartements(label)` → codes département pour le fallback Recherche Entreprises.
  - `computeFiltersSignature` → SHA-256 12 chars hex (tranches+CP+NAF triés/normalisés).
- **Persistance curseur** (`profiles.sourcing_state` JSONB) :
  - Reset à `*` si la signature stockée diffère de la signature courante (univers changé).
  - Reset à `*` si `exhausted_at` < 7 jours (refresh univers).
  - Sinon reprendre `state.curseurSuivant`.
- **Boucle adaptative** (`runAdaptiveSourcing`) :
  - Appelle `sourcerEntreprises({ curseur, pageSize:100, maxPages:1, excludeSirens })` page par page.
  - Stop dès que `candidates >= max(daily_call_target × 3, 50)` OU `curseurSuivant === curseur` (univers Sirene épuisé).
  - Caps de sécurité : `HARD_CAP_PAGES=50` et `HARD_CAP_DURATION_MS=4 min` (cron Vercel time out à 5 min).
  - Mode dégradé : `SireneApiError` à la première page → bascule sur `sourcerEntreprisesFallback` (Recherche Entreprises, sans curseur, 1 appel).
- **Enrichissement ADEME** : `Promise.allSettled` batches de 20 (pas de bloquer sur échec individuel — mode dégradé : l'étab passe sans données BEGES).
- **Scoring** : `calculerScore(prospect, dejaContacte=false)` → score 0-100, `statut = score >= 20 ? 'qualified' : 'sourced'`.
- **Upsert** : batches de 50 (`onConflict: 'user_id,siren'`). Heuristique `created_at === updated_at` → `prospects_new` vs `prospects_updated`. Fallback migration 004 (beges_url/beges_valide) si nécessaire.
- **Counters** remplis dans `agent_runs` : `prospects_sourced`, `prospects_qualified`, `prospects_new`, `prospects_updated`, `sirene_total_available`, `sirene_pages_loaded`, `sirene_curseur_final`.
- **Logging structuré par page** : phase `sourcing_page` avec `curseur`, `curseurSuivant`, `returned`, `candidates_so_far`, `target`, `used_fallback` — utile pour diagnostiquer si l'univers Sirene plafonne.

> Note : l'ancienne phase 4 isolée (`phaseScoring`) a été supprimée — son rôle (scoring + upsert) est intégré dans `runPipelineSourcing`. Les compteurs `agent_runs.prospects_qualified` sont renseignés à la sortie de cette phase fusionnée.

### 4.5 contact_enrichment
- **Non-fatale**. Top 10 prospects `score_priorite > 70` AND (`contact_email IS NULL` OR `contact_telephone IS NULL`).
- Séquentiel (pas de parallélisme) pour préserver les quotas gratuits Pappers / Hunter.
- Sans `PAPPERS_API_KEY` ou `HUNTER_API_KEY` → phase ignorée silencieusement.

### 5. selection
- `target = settings.daily_call_target ?? 15`.
- Filtre : `user_id`, `statut in ('sourced','qualified')`, `beges_publie=false OR beges_valide=false`, ORDER BY `score_priorite DESC`, LIMIT target.
- Exclut les `prospect_id` déjà présents dans la `daily_list` du jour (idempotence).

### 6. generation_pitch
- `genererPitchsBatch(prospects, settings)` → GPT-4o.
- Groupes de 5 en parallèle, délai 150 ms entre groupes (RPM standard gpt-4o = 500).
- Si un pitch échoue → fallback minimal (ne bloque pas le batch).

### 7. construction_liste
- Upsert `daily_lists` (status `generating`) avec `onConflict: 'user_id,date'`.
- **Mode append cumulatif** : pas de DELETE des items existants. Récupère `MAX(ordre)` actuel et décale les nouveaux items (ordre += lastOrdre). Les items déjà appelés ET non appelés sont conservés.
- Insert `daily_list_items`.
- UPDATE `daily_lists` → status `ready`, `generated_at = NOW()`.

## Idempotence

Si le cron tourne 2× la même nuit (Vercel retry sur non-200, ou trigger manuel) :
1. `phaseInit` détecte un run déjà `running` → throw → 409.
2. Sinon, à `phaseSelection` les prospects déjà dans la liste sont exclus → pas de doublons.
3. À `phaseCreateDailyList` l'upsert `daily_lists` est idempotent ; les items ajoutés continuent la numérotation `ordre` (mode append).
4. Conséquence : 2 runs successifs **agrandissent** la liste si de nouveaux prospects qualifiés existent.
5. **Curseur jamais perdu** : `runPipelineSourcing` (`lib/agent/sourcing-runner.ts:830-880`) enveloppe boucle + enrich + upsert dans `try/finally` → `persistSourcingState` est appelé même si enrich/upsert throw, tant que la boucle a produit un `outcome` (curseur consommé toujours écrit en base).

## Compteurs typiques (post-Wave 2.2)

| Phase                | Volume attendu |
|----------------------|----------------|
| Sirene candidats     | `max(daily × 3, 50)` (cible adaptative, peut dépasser si page ramène plus) |
| Pages Sirene chargées| 1-5 selon l'univers (max 50 hard cap) |
| Après dédup          | identique candidats (dedup déjà appliquée via `excludeSirens`) |
| Enrichis ADEME       | identique candidats |
| Qualifiés (score≥20) | 30-70% des candidats |
| Top sélectionnés     | 15 (par défaut) |
| Pitchs générés       | 15 (parallèle 5×3) |

## Mode dégradé

- Sirene 5xx ou réseau down → `SireneApiError` propagé → bascule sur `sourcerEntreprisesFallback` (une seule fois, pas de curseur).
- Sirene + fallback down → `runAdaptiveSourcing` throw → phase échoue (`status=failed`, `error_message`). `sourcing_state` non mis à jour.
- Sirene 4xx (auth invalide, etc.) → `sourcerEntreprises` retourne `etablissements=[]` et `exhausted=true` → la boucle s'arrête, le runner n'écrit rien.
- ADEME timeout sur un étab → log warn, l'étab passe sans enrichissement BEGES (mode dégradé conservé Wave 2.2).
- Migration 004 non appliquée (colonnes `beges_url`/`beges_valide` absentes) → retry upsert sans ces colonnes (warn).
- Pappers/Hunter manquants → phase 4.5 silencieuse.
- OpenAI rate limit → pitch fallback minimal (à vérifier dans `lib/agent/pitch-gen.ts` pour la stratégie exacte).

## Observabilité (post-Wave 2.2)

- `agent_runs.sirene_total_available` : `header.total` Sirene de la 1re page (taille de l'univers déclaré).
- `agent_runs.sirene_pages_loaded` : nombre de pages Sirene fetchées dans ce run.
- `agent_runs.sirene_curseur_final` : dernier `curseurSuivant` reçu — à comparer à `profiles.sourcing_state.curseurSuivant` pour valider la persistance.
- `agent_runs.prospects_new` / `prospects_updated` : breakdown post-upsert.
- `agent_runs.logs[].data.signature` (phase `sourcing_init`) : signature des filtres effectifs — utile pour diagnostiquer une invalidation curseur inattendue.
- `profiles.sourcing_state.exhausted_at` : si non-null → l'univers Sirene est épuisé pour ces filtres ; un nouveau run dans les 7 jours suivants forcera un reset curseur (refresh).
