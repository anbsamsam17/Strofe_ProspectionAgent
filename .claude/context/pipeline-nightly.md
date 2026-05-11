# Pipeline nocturne — flow complet

Le pipeline est orchestré par `lib/agent/orchestrator.ts` (`runAgentNocturne`), déclenché par le cron Vercel 22h sur `/api/agent/run`.

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
    ├─ Phase 3  sourcing_sirene    → API Sirene INSEE (200 max)
    │                                  ↓ fallback si 0 résultats
    │                                Recherche Entreprises gouv (open data, dédup en amont via excludeSirens)
    │           enrichissement     → ADEME BEGES (data.ademe.fr), batches de 20 en parallèle
    ├─ Phase 4  scoring            → calculerScore() 0-100 → upsert prospects (batches de 50)
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

### 3. sourcing + enrichissement
- **Input** : settings.
- **Action sourcing** : valide les codes NAF (regex `^\d{2}\.\d{2}[A-Z]$`). Si vide ou invalide → `NAF_PRIORITAIRES_DEFAULT` (~30 codes : viticulture, aéronautique, logistique, agro, industries, transport, énergie, déchets, BTP, hôtellerie, santé).
- Appel Sirene INSEE (200 max). Si 0 résultats ou exception → fallback Recherche Entreprises gouv avec `excludeSirens` pour ne pas regaspiller de quota sur les pages déjà connues.
- Dédup vs SIREN déjà en base pour ce user.
- **Action enrichissement** : appel ADEME pour chaque établissement, **batches de 20 en parallèle** via `Promise.allSettled` (200 étabs ~3-4 s vs ~60 s en séquentiel).
- **Compteur typique** : 200 sourcés → ~100-150 nouveaux après dédup → enrichis.

### 4. scoring
- `calculerScore(prospect, dejaContacte=false)` → score 0-100 + `score_details` JSON.
- `statut = score >= 20 ? 'qualified' : 'sourced'`.
- Upsert par batches de 50 (`onConflict: 'user_id,siren'`).
- Fallback : si les colonnes `beges_url`/`beges_valide` (migration 004) n'existent pas, retry sans elles.
- Non-fatal : si la phase échoue, on continue avec les prospects déjà en DB.

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

## Compteurs typiques

| Phase                | Volume attendu |
|----------------------|----------------|
| Sirene sourcés       | ~200 (cap)     |
| Après dédup          | 50-150         |
| Après enrichissement | identique      |
| Qualifiés (score≥20) | 80-130         |
| Top sélectionnés     | 15 (par défaut)|
| Pitchs générés       | 15 (parallèle 5×3) |

## Mode dégradé

- Sirene down → fallback Recherche Entreprises.
- Sirene + fallback down → run échoue (`status=failed`, `error_message`).
- ADEME timeout sur un étab → log warn, l'étab passe sans enrichissement BEGES.
- Pappers/Hunter manquants → phase 4.5 silencieuse.
- OpenAI rate limit → pitch fallback minimal (à vérifier dans `lib/agent/pitch-gen.ts` pour la stratégie exacte).
