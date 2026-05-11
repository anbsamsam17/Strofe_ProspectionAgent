# TODO — Refonte sourcing & observabilité

**Initiative** : `fix/sourcing-pagination` • **Démarrée** : 2026-05-11
**Pilote** : agent `orchestrator` (dispatche les sous-agents Opus en parallèle par vagues)

---

## 1. Contexte (pourquoi cette refonte)

Symptôme observé : plateau dur à **540 prospects** ; chaque run de sourcing ne ramène ensuite que 2-3 nouveaux.

Diagnostic confirmé par audit 5-agents (2026-05-11) :

- **Pagination figée** : `lib/agent/sourcing.ts:244` repart de `debut = 0` à chaque run ; `maxResults: 200` hardcodé partout (`sourcing.ts:212`, `orchestrator.ts:286`, `sourcing-runner.ts:277`). Sirene ne reçoit pas `excludeSirens` → on refetch toujours les 200 mêmes SIREN.
- **Univers étroit** : Gironde uniquement (`codePostalEtablissement:[33000 TO 33999]` en dur, `sourcing.ts:62`), tranches 21-53, 41 NAF figés → univers réel ≈ 500-800 entités.
- **UI ignorée** : `sourcing-modal.tsx` envoie `effectifMin/Max` et `targetRegion`, route valide, mais `sourcing-runner.ts:277` ne les passe jamais à `sourcerEntreprises`. Bug de câblage.
- **Trous d'observabilité** : aucun log de `sirene_header.total`, `debut` final, breakdown post-dedup/ADEME/score, ni new/updated dans `agent_runs`. Impossible de diagnostiquer en BDD.

## 2. Décisions d'architecture (figées, validées par user)

| Décision | Choix |
|---|---|
| Persistance curseur | `profiles.sourcing_state JSONB { curseur, filters_signature, last_total, exhausted_at, last_run_at }` |
| Comportement pagination | **Mode adaptatif** : boucle fetch→dedup→enrich ADEME→score, stop quand `N qualified` atteint ou curseur épuisé (`curseurSuivant === curseur`). N = `max(daily_call_target × 3, 50)` |
| Élargissement filtres défauts | **Phase 2 séparée** — cette refonte branche l'UI, les défauts restent les actuels |
| Source de pagination | API Sirene officielle **curseur** (`curseur=*`, lire `header.curseurSuivant`). Fallback Recherche Entreprises gouv conservé en cas de panne Sirene uniquement |

## 3. Plan d'exécution — vagues dispatchées par l'orchestrator

Chaque vague = plusieurs sous-agents Opus en **parallèle**. L'orchestrator attend la fin d'une vague (et vérifie l'acceptance) avant de lancer la suivante.

### Wave 0 — Préparation (orchestrator seul, ~5 min)

- [ ] Vérifier git status propre, branche `main`
- [ ] Créer branche `fix/sourcing-pagination`
- [ ] Lire ce TODO + `.claude/context/pipeline-nightly.md` + `.claude/context/data-model.md`

### Wave 1 — Fondations parallèles (3 agents, ~30 min)

| # | Agent | Scope | Fichiers cibles | Acceptance |
|---|---|---|---|---|
| 1.1 | `supabase-schema-keeper` | Migration 005 : ajoute `profiles.sourcing_state JSONB` (default `'{}'`) + colonnes `agent_runs.prospects_new INT`, `prospects_updated INT`, `sirene_total_available INT`, `sirene_pages_loaded INT`, `sirene_debut_final INT`, `sirene_curseur_final TEXT` (toutes nullable). Régénère types TS via `npx supabase gen types`. | `supabase/migrations/005_sourcing_state_and_counters.sql`, `lib/supabase/database.types.ts` | SQL valide, types regen sans erreur, applied local OK |
| 1.2 | `beges-domain-expert` | Spec du mapping UI→Sirene : table de correspondance `effectifMin/Max` (chiffre humain) → tranches INSEE (`12`,`21`,`22`,...,`53`) ; mapping `targetRegion` (ville/dept/region label) → Lucene `codePostalEtablissement:[X TO Y]` + paramètre `departement` du fallback. Inclure les edge cases (effectif 0/1/2-5 NSP). | `.claude/context/sourcing-param-mapping.md` (nouveau) | Tableau exhaustif, cas limites traités |
| 1.3 | `test-engineer` | Fixtures Sirene : 3 pages de réponses curseur + page terminale (curseurSuivant === curseur). Mocks pour ADEME (batch enrich) et scoring partiel. | `lib/agent/__tests__/fixtures/sirene-cursor.ts`, `lib/agent/__tests__/fixtures/ademe.ts` | Fixtures importables, types corrects |

**Sync point** : orchestrator review les 3 outputs ; vérifie qu'il n'y a pas de conflit de chemins. Si OK → Wave 2.

### Wave 2 — Implémentation parallèle (4 agents, ~2 h)

Toutes les briefs Wave 2 doivent référencer les outputs de Wave 1.

| # | Agent | Scope | Fichiers cibles | Dépendances |
|---|---|---|---|---|
| 2.1 | `external-api-integrator` | Refactor `sourcerEntreprises` pour : (a) pagination curseur INSEE (`curseur=*` init, lire `header.curseurSuivant`, stop sur égalité), (b) accepter `excludeSirens?: Set<string>` (skip côté code mais surtout permet la boucle adaptative), (c) accepter `effectifTranches: string[]` et `codePostalRange: [string, string]` au lieu des constantes, (d) retourner `{ etablissements, curseur, curseurSuivant, totalAvailable, pagesLoaded }`. Ajoute logs structurés. **NE PAS toucher** au fallback Recherche Entreprises ni à l'orchestration. | `lib/agent/sourcing.ts` (fonction `sourcerEntreprises` et signatures de types) | Wave 1.2 (mapping) |
| 2.2 | `agent-pipeline-engineer` | Boucle adaptative dans `sourcing-runner.ts` (et clone même logique dans `orchestrator.ts`) : (1) charger `profiles.sourcing_state.curseur` + signature filtre, invalider si signature change ; (2) boucler `sourcerEntreprises` page par page ; (3) après chaque page : dedup `sirenSet`, enrich ADEME (batch 20), scoring, compter qualified ; (4) stop quand `qualified_count >= N` OU curseur épuisé ; (5) à la fin, persister `sourcing_state.curseur = curseurSuivant`, `last_total`, `exhausted_at` si épuisé ; (6) logger breakdown complet dans `agent_runs.logs` ET remplir les nouvelles colonnes. | `lib/agent/sourcing-runner.ts`, `lib/agent/orchestrator.ts` (la section sourcing) | Wave 1.1 (migration + types), Wave 2.1 (signature sourcerEntreprises) |
| 2.3 | `nextjs-route-architect` | Audit `app/api/agent/sourcing/route.ts` : Zod schema explicite pour body (`effectifMin?`, `effectifMax?`, `targetRegion?`, `nafCodes?`), validation cohérence (`effectifMin <= effectifMax`), erreurs typées. Vérifie que ces params sont bien transmis à `runSourcing`. | `app/api/agent/sourcing/route.ts` | aucune |
| 2.4 | `ui-component-builder` | Audit `SourcingModal` : confirme l'envoi des bons params au backend, ajoute un état UI "univers épuisé" (badge orange) si la réponse contient `exhausted: true`, affiche `lastTotal` si dispo. **NE PAS** changer les défauts de filtres (phase 2). | `components/sourcing-modal.tsx` (ou équivalent), composant qui consomme la réponse de l'API | concurrent avec 2.3 (pas de conflit) |

**Sync point** : `npm run type-check` doit passer après Wave 2. Si rouge → fix de l'agent fautif.

### Wave 3 — Validation parallèle (3 agents, ~1 h)

| # | Agent | Scope | Output |
|---|---|---|---|
| 3.1 | `test-engineer` | Tests Vitest sur tous les changements Wave 2 : pagination curseur (3 cas : début, mid, fin), boucle adaptative (stop à N, stop à épuisement), wiring UI→sourcing (params bien transmis), breakdown des logs. Cible coverage ≥ 80 % sur `lib/agent/sourcing.ts` et `lib/agent/sourcing-runner.ts`. | Tests passants, rapport coverage |
| 3.2 | `security-auditor` | Audit : `profiles.sourcing_state` couvert par les policies RLS existantes (auth.uid() = user_id), aucun PII dans les logs `agent_runs` (pas de SIREN/SIRET en clair dans messages si on respecte la policy actuelle, à vérifier), pas de log de `INSEE_CLIENT_SECRET` même en debug. | Rapport go/no-go |
| 3.3 | `code-reviewer` | Review diff complet : pas de `any`, Zod aux frontières, RLS respectée (pas de filter user_id manuel ajouté), erreurs typées, naming cohérent, commentaires only où le pourquoi est non-obvie, pas de TODO sans ticket. | Rapport go/no-go, liste blockers |

**Sync point** : si l'un des 3 rapports est rouge → boucle de fix avec l'agent owner, puis re-check.

### Wave 4 — Documentation & merge (séquentiel, ~20 min)

| # | Agent | Scope |
|---|---|---|
| 4.1 | `agent-pipeline-engineer` | Update `.claude/context/pipeline-nightly.md` (phase adaptative), `.claude/context/external-apis.md` (Sirene curseur), `.claude/context/scoring-rules.md` (mention si seuil utilisé pour stop adaptatif) |
| 4.2 | `supabase-schema-keeper` | Update `.claude/context/data-model.md` (colonne `sourcing_state`, nouvelles colonnes `agent_runs`) |
| 4.3 | `cron-watchdog` | Vérifie que le run nocturne respecte un cap de durée (Vercel cron timeout) avec la boucle adaptative ; ajoute un cap dur (ex. 50 pages max ou 5 min) si le mode adaptatif risque de timeouter |
| 4.4 | `orchestrator` | `npm run type-check && npm run lint && npm run test` une dernière fois. Commit avec message structuré. Demande à l'utilisateur avant `git push` |

## 4. Acceptance globale (DoD)

- [ ] `npm run type-check` ✅
- [ ] `npm run lint` ✅
- [ ] `npm run test` ✅ (coverage ≥ 80 % sur les fichiers touchés)
- [ ] Migration 005 appliquée en local
- [ ] Sur un compte user à 540 prospects (à reproduire en dry-run ou pré-prod) : un run ramène **> 50 nouveaux** prospects
- [ ] `agent_runs.logs` du dernier run contient : `sirene_header_total`, `sirene_pages_loaded`, `sirene_curseur_final`, breakdown new/updated
- [ ] `profiles.sourcing_state` populé après un run (curseur ≠ '*')
- [ ] Modal UI fonctionnelle : changer `effectifMin/Max` ou `targetRegion` modifie effectivement le sourcing

## 5. Mode opératoire orchestrator (résumé pour dispatch)

```
loop:
  for wave in [1, 2, 3]:
    parallel-dispatch tasks of wave to their respective agents
    await all
    verify acceptance of wave
    if any task failed:
      route fix to owning agent
      re-verify
  sequential-dispatch wave 4
  ask user before push
```

## 6. Anti-patterns à proscrire

- ❌ Ne PAS paralléliser deux agents qui touchent le même fichier dans la même vague
- ❌ Ne PAS implémenter la boucle adaptative sans le scoring mocké en test (sinon test = appel OpenAI réel)
- ❌ Ne PAS oublier `npx supabase gen types` après la migration — sinon TS compile mais types runtime sont faux
- ❌ Ne PAS hardcoder une nouvelle constante en remplaçant l'ancienne — passer par les params reçus de l'UI
- ❌ Ne PAS supprimer le fallback Recherche Entreprises gouv — c'est le filet de sécurité quand Sirene est down

## 7. Trous d'observabilité comblés par cette refonte

| Métrique | Source | Stockage |
|---|---|---|
| `sirene_header_total` | Réponse Sirene `header.total` | `agent_runs.sirene_total_available` |
| `sirene_pages_loaded` | Compteur dans boucle | `agent_runs.sirene_pages_loaded` |
| `sirene_debut_final` | Dernier `debut` envoyé | `agent_runs.sirene_debut_final` |
| `sirene_curseur_final` | Dernier `curseurSuivant` | `agent_runs.sirene_curseur_final` |
| `prospects_new` | Heuristique `created_at === updated_at` | `agent_runs.prospects_new` |
| `prospects_updated` | Heuristique inverse | `agent_runs.prospects_updated` |
| Breakdown par phase | Log structuré par phase | `agent_runs.logs` JSONB |
| Curseur user | Persistance entre runs | `profiles.sourcing_state.curseur` |
| Univers épuisé (signal) | Détection `curseurSuivant === curseur` | `profiles.sourcing_state.exhausted_at` |

## 8. Phase 2 (à planifier après merge de cette initiative)

- Élargissement filtres défauts : multi-départements (33+24+40+47+64), tranche min 20 salariés
- Rotation des NAF entre runs (ne pas chercher tous les 41 à chaque fois)
- Mode "exploration" vs "exploitation" : alterner runs d'exploration (large) et exploitation (top secteurs)
- Dashboard `/dashboard` : afficher `last_total`, `exhausted_at`, suggestion d'élargir filtres si épuisé

## 9. Rollback

- `git revert <commit-merge>` pour le code
- Migration 005 forward-only : si rollback DB nécessaire, créer migration 006 inverse (`ALTER ... DROP COLUMN`). Données `sourcing_state` non critiques, peuvent être perdues.

---

**Status** : 📋 Prêt à dispatcher. L'orchestrator peut démarrer Wave 0 à la demande de l'utilisateur.
