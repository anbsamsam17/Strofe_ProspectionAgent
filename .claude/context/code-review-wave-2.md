# Code review Wave 1+2 — fix/sourcing-pagination

Reviewer : code-reviewer (Opus 4.7) — 2026-05-11
Périmètre : commits 9404c6c, 8c39600, 4e8aed9, 08baf4d + migration 005
Méthode : lecture diff (`git diff main..HEAD`, ~3 800 lignes), checklist A–J,
`npm run type-check` ✅ (0 erreur), `grep` ciblé sur anti-patterns du projet.

## Verdict global

🟡 **LGTM avec changements demandés** — 0 blocker, 5 findings importants, 6 mineurs.

Le refactor est solide sur l'essentiel : pagination curseur INSEE conforme à la
convention officielle (`*` → `curseurSuivant`, terminaison sur égalité), boucle
adaptative bornée (caps pages + durée), signature SHA-256 pour invalider le
curseur, fallback Recherche Entreprises préservé, types stricts (zéro `any`),
Zod durci sur la route. Le découpage `runPipelineSourcing` / `runAdaptiveSourcing`
est propre et réutilisé par les deux callers (UI manuel + orchestrator nocturne).
Les findings importants concernent surtout :
- l'absence de tests pour `sourcing.ts` et `sourcing-runner.ts` après refactor
  (le seul fichier de tests commité est `sourcing-mapping.test.ts`),
- la réponse `/api/agent/sourcing` qui n'expose pas les champs attendus par
  la nouvelle modal (`exhausted`, `totalAvailable`, `pagesLoaded`),
- un défaut « France entière » dans le mapping qui ne matche pas
  `[33000 TO 33999]` legacy quand l'orchestrator nocturne n'a aucun
  `targetRegion`.

Tout est fixable en quelques minutes ; rien ne casse l'existant à ma lecture.

## Findings critiques (🔴 — bloquants)

_Aucun._

## Findings importants (🟡 — fixer avant merge)

### F-IMP-01. Réponse `/api/agent/sourcing` incomplète — la modal perd ses nouvelles features

`app/api/agent/sourcing/route.ts:182-191` renvoie uniquement
`{ success, runId, prospectsNew, prospectsUpdated, duration_ms }`.

La modal `components/dashboard/sourcing-modal.tsx:81-104` est conçue pour lire
en plus : `prospectsQualified`, `totalAvailable`, `exhausted`, `pagesLoaded`,
`durationMs`. Aucun de ces champs n'est aujourd'hui renvoyé par la route → :
- le badge « Univers de recherche épuisé » (`sourcing-modal.tsx:429-470`)
  n'apparaît jamais (`stats.exhausted` toujours `false`),
- les cards « Qualifiés », « Pages Sirene », « Univers total » ne s'affichent
  jamais (`stats.prospectsQualified` / `totalAvailable` / `pagesLoaded` tous `null`),
- la valeur retournée par `runSourcing` (`output.qualifiedCount`, `output.outcome.*`)
  est calculée mais jetée par la route.

**Fix** : étoffer la réponse :

```ts
// app/api/agent/sourcing/route.ts:182
return NextResponse.json(
  {
    success: true,
    runId: result.runId,
    prospectsNew: result.prospectsNew,
    prospectsUpdated: result.prospectsUpdated,
    duration_ms: result.duration_ms,
    // Nouveaux champs Wave 2.4 — alignés sur RunStats côté modal
    prospectsQualified: result.qualifiedCount,
    totalAvailable: result.totalAvailable,
    pagesLoaded: result.pagesLoaded,
    exhausted: result.exhausted,
  },
  { status: 200 },
)
```

Cela suppose que `runSourcing` retourne ces champs (à compléter dans
`SourcingResult` `sourcing-runner.ts:56-61` qui n'expose actuellement que
`runId / prospectsNew / prospectsUpdated / duration_ms`).

### F-IMP-02. Aucun test sur `sourcing.ts` ni `sourcing-runner.ts` n'est commité

`git diff main..HEAD --stat -- lib/agent/__tests__/` ne montre QUE
`sourcing-mapping.test.ts` (255 lignes) + les fixtures.

Un fichier `lib/agent/__tests__/sourcing.test.ts` est présent en local mais
**non commité** (`git status` → `?? lib/agent/__tests__/sourcing.test.ts`).
Conséquences :
- la pagination curseur, les retries 5xx, la validation Zod-equivalent dans
  `validateSourcerParams`, le filtrage `excludeSirens`, et le fallback
  Recherche Entreprises ne sont vérifiés par AUCUN test du diff,
- la boucle adaptative (`runAdaptiveSourcing`, `runPipelineSourcing`,
  `resolveStartCurseur`, `parseSourcingState`) n'a aucun test du tout —
  alors que c'est l'élément le plus critique de la refonte.

Le TODO §3 Wave 3.1 dit explicitement « Tests Vitest sur tous les changements
Wave 2 […] coverage ≥ 80 % sur `sourcing.ts` et `sourcing-runner.ts` ». La DoD
§4 ajoute « `npm run test` ✅ ». Aujourd'hui ces deux items NE PEUVENT PAS
être validés tant que Wave 3.1 n'est pas mergée.

**Fix** : faire suivre obligatoirement Wave 3.1 (test-engineer) avant merge,
OU committer le fichier `sourcing.test.ts` local s'il est complet (le path et
le harness des tests laissent supposer que oui — à vérifier rapidement).

### F-IMP-03. `mapRegionToCodePostal(undefined)` casse l'orchestrator nocturne (régression silencieuse de l'univers Gironde)

`lib/agent/sourcing-mapping.ts:180-184` retourne `['00000','99999']` quand
`label === undefined`. C'est cohérent pour la modal UI (zone vide = France),
mais l'orchestrator nocturne `lib/agent/orchestrator.ts:258` appelle
`runPipelineSourcing({ params: { targetSectors: settings.target_sectors } })` —
**sans `targetRegion`**. Conséquences en cascade :
- `resolveSourcingFilters` (`sourcing-runner.ts:194-225`) appelle
  `mapRegionToCodePostal(undefined)` → range `['00000','99999']`,
- `mapRegionToDepartements(undefined)` → `[]`,
- l'univers Sirene devient « France entière 50+ salariés sur 41 NAFs » au lieu
  du legacy « Gironde 50+ salariés sur 41 NAFs ».

C'est un **changement de comportement par défaut** du run nocturne, non flaggé
dans le TODO (qui dit en §2 « les défauts restent les actuels » et §6 « Ne PAS
hardcoder une nouvelle constante en remplaçant l'ancienne »). Quand un compte
est déjà saturé à 540 prospects Gironde, ça résout symboliquement le plateau
en élargissant à la France — mais ce n'est pas la décision figée du TODO,
c'est un effet de bord.

**Choix possibles** (à arbitrer avec le pilote) :
1. Réintroduire un défaut Gironde explicite côté orchestrator nocturne :
   `params: { targetSectors: ..., targetRegion: 'Gironde' }`.
2. Distinguer « pas de label fourni » (→ défaut historique Gironde) vs
   « label vide explicite / 'France' » (→ France entière) — la sentinelle
   `FRANCE_LABELS` ne gère que les libellés explicites.
3. Acter le changement de scope par défaut, mais alors ajouter une note
   dans `pipeline-nightly.md` et le TODO (Wave 4.1).

À mon sens, **option 1 ou 2 préférable** — c'est l'orchestrator qui doit
décider d'élargir, pas un effet de bord du mapping. Le TODO §8 prévoit déjà
cet élargissement en Phase 2.

### F-IMP-04. `runSourcing` ne propage pas `output.outcome.*` dans son retour

`lib/agent/sourcing-runner.ts:856-971` : `SourcingResult` n'expose que
`runId, prospectsNew, prospectsUpdated, duration_ms`. Tous les counters
Sirene calculés (`totalAvailable`, `pagesLoaded`, `curseurFinal`, `exhausted`,
`qualifiedCount`) sont écrits en DB via `updateRunInDB(:951)` mais jamais
rendus disponibles au caller HTTP. C'est le bug racine de F-IMP-01.

**Fix** : étendre `SourcingResult` (`sourcing-runner.ts:56-61`) avec les
champs nécessaires à la modal, puis les retourner depuis `runSourcing`
après `updateRunInDB`. La donnée est déjà dans `output` ligne 935.

### F-IMP-05. `sourcing_state` n'est PAS persisté en cas d'échec pipeline (idempotence partielle)

`lib/agent/sourcing-runner.ts:912-933` : si `runPipelineSourcing` throw,
le `catch` log le run en `failed` mais **`persistSourcingState` n'est jamais
appelé**. Conséquence :
- si la boucle adaptative a déjà chargé 3 pages avant un crash ADEME, le
  curseur Sirene avancé n'est pas mémorisé → run suivant repart de `*`,
- on **refetche** les pages déjà vues, ce qui ré-introduit le symptôme
  initial du plateau de prospects.

Le TODO §H mentionne explicitement « Persistance `sourcing_state` même en cas
d'erreur (idempotence) » comme acceptance.

**Fix** : `runPipelineSourcing` (`sourcing-runner.ts:739`) doit englober la
boucle adaptative dans un `try/finally` qui persiste l'état même sur erreur,
OU `runSourcing` doit catcher et persister un état partiel avant de re-throw.
Architecture suggérée :

```ts
// runPipelineSourcing : encapsuler le tail dans un finally
try {
  outcome = await runAdaptiveSourcing(...)
  // ... enrich + score + upsert
} finally {
  if (outcome) {
    await persistSourcingState(userId, supabase, {
      curseur: outcome.curseurFinal,
      curseurSuivant: outcome.curseurFinal,
      filters_signature: filters.signature,
      last_total: outcome.totalAvailable,
      exhausted_at: outcome.exhausted ? new Date().toISOString() : null,
      last_run_at: new Date().toISOString(),
    })
  }
}
```

## Findings mineurs (🟢 — nice to have)

### F-MIN-01. Duplication `NAF_PRIORITAIRES` entre `sourcing.ts` et `sourcing-runner.ts`

`lib/agent/sourcing.ts:55-78` (`NAF_PRIORITAIRES`, 41 codes) est dupliqué dans
`lib/agent/sourcing-runner.ts:114-136` (`NAF_PRIORITAIRES_DEFAULT`, exactement
les mêmes 41 codes). Risque de divergence silencieuse à la prochaine évolution
des secteurs cibles.

**Fix** : exporter `NAF_PRIORITAIRES` depuis `sourcing.ts` et l'importer
dans `sourcing-runner.ts` (ou les deux depuis un nouveau `sourcing-defaults.ts`).

### F-MIN-02. `catch {}` silencieux sur le chargement des settings UI

`lib/agent/sourcing-runner.ts:907-909` : `} catch { pushLog(...) }` — le `catch`
ne capture pas la cause de l'erreur. Si Supabase tombe en panne ou si l'UUID
est mal formé, le log dit juste « Settings introuvables — paramètres par défaut
utilisés » sans le message d'origine. Idem `sourcing.ts:673-675` (parse JSON
fallback), `sourcing.ts:835-836` / `:844-846` (rechercherTelephone), tous
silencieux. Pas critique car fallback documenté, mais on perd de la trace.

**Fix** : a minima, `catch (err)` + log `err.message` dans le contexte du `pushLog`.

### F-MIN-03. `as unknown as` répétitif sur les inserts Supabase

`sourcing-runner.ts:311, 348, 649, 658, 906`, `orchestrator.ts:91, 201, 471, 612`.
La cause racine est que `Partial<Prospect>` du runner ne matche pas exactement
`Database['public']['Tables']['prospects']['Insert']` (PII enrichis, signaux JSON,
score_details JSON). Toléré par les règles projet (`code-style.md` §TypeScript :
« sauf cast sûr et commenté »), mais aucun de ces casts n'a de commentaire.

**Fix** (pas bloquant) : ajouter une fonction `toProspectInsert(p: Partial<Prospect>)
: Database['public']['Tables']['prospects']['Insert']` qui matérialise la
conversion (notamment `signaux as unknown as Json`, `score_details as unknown as Json`).

### F-MIN-04. `'use client'` + dépendance directe à `react-dom/createPortal`

`components/dashboard/sourcing-modal.tsx:1-4` : OK pour la modal (state, focus,
event handlers, portal), conforme aux règles `code-style.md` §Next.js/React.
Pas de `service_role`, pas de fetch Supabase direct (passe par `/api/agent/sourcing`).
Le `window.location.reload()` (`:217`) après run pourrait être remplacé par un
`router.refresh()` Next 15, mais c'est un nit qui touche un comportement
historique du dashboard, pas Wave 2.

### F-MIN-05. `database.types.ts` ne contient toujours pas `beges_url` / `beges_valide`

`lib/supabase/database.types.ts` n'a PAS été régénéré pour inclure les colonnes
de la migration 004 (`beges_url`, `beges_valide`). C'est pré-existant à cette
PR (déjà absent sur main), mais Wave 1.1 aurait pu en profiter pour les ajouter
en éditant manuellement le fichier (comme c'est précisé dans la migration 005
ligne 96-97). Conséquence : le fallback `if (result1.error.message.includes('beges_'))`
(`sourcing-runner.ts:654`) reste utile mais devrait pouvoir être retiré une
fois les types alignés.

### F-MIN-06. `parseSourcingState` ne valide pas la cohérence inter-champs

`sourcing-runner.ts:235-247` accepte des shapes hybrides type
`{ curseur: 'abc', filters_signature: undefined }` (curseur sans signature →
`resolveStartCurseur` retourne `'fresh'` à juste titre, mais c'est implicite).
Pas grave car `resolveStartCurseur` gère robustement, mais un test de bord
(« state corrompu avec curseur mais sans signature ») serait utile.

## Conformité par catégorie

| Catégorie | Status | Notes |
|---|---|---|
| A. TypeScript strict | 🟢 | `grep ': any\|as any\|@ts-ignore'` → 0 occurrence. Types exportés : `SireneApiError`, `SireneValidationError`, `SourcerEntreprisesParams`, `SourcerEntreprisesResult`, `AdemeBegesDataFairRecord`, `SourcingState`, `AdaptiveSourcingOutcome`, `ResolvedSourcingFilters`, `RunAdaptiveSourcingOptions`, `PipelineSourcingInput`, `PipelineSourcingOutput`, `SourcingResult` (≥ 5). `as unknown as Json` justifié (Supabase typage `Json` strict). |
| B. Server vs Client | 🟢 | `'use client'` uniquement dans `sourcing-modal.tsx`, justifié (portal, state, fetch). `service_role` jamais importé côté client (`grep SERVICE_ROLE components/` → 0). |
| C. Validation aux frontières | 🟢 | Zod `.strict()` + `.refine()` cross-field (`route.ts:42-68`), `SireneValidationError` levée pré-flight dans `validateSourcerParams` (`sourcing.ts:313-376`). NAF regex stricte `^\d{2}\.\d{2}[A-Z]$`, targetRegion regex Unicode 1..30. |
| D. Erreurs | 🟡 | `SireneApiError` / `SireneValidationError` typées et propagées correctement. **Mais** `catch {}` silencieux sur 6 sites (F-MIN-02) — pas bloquant car non-critique. Aucun `.catch(() => null)` qui mask un check sécurité. |
| E. RLS | 🟢 | Le filter `.eq('user_id', user.id)` dans `route.ts:130` est explicitement justifié + commenté (« service_role bypasse RLS, donc sans ce filter on inspecterait les runs de tous les users » — `:122-124`). Idem `persistSourcingState` (`sourcing-runner.ts:341-362`). Conforme `security.md §RLS`. |
| F. Conventions | 🟢 | Naming OK (français métier `phaseSourcing*`, anglais technique `runPipelineSourcing`), imports ordonnés (stdlib `node:crypto` → externes → `@/lib/*` → relatifs), constantes nommées (`HARD_CAP_PAGES=50`, `HARD_CAP_DURATION_MS=240000`, `SCORE_QUALIFICATION_SEUIL=20`, `EXHAUSTED_RESET_DAYS=7`), commentaires WHY (la plupart), pas de code mort, pas de `TODO` non daté. |
| G. Tests | 🔴→🟡 | Mocks systématiques OK dans les fixtures, mais **aucun test commité** pour `sourcing.ts` (refactor majeur) ni `sourcing-runner.ts` (nouveau pipeline). Seul `sourcing-mapping.test.ts` (32 tests) est commité — c'est F-IMP-02. Wave 3.1 doit livrer avant merge. |
| H. Performance / Robustesse | 🟡 | Caps de sécurité OK (`HARD_CAP_PAGES=50`, `HARD_CAP_DURATION_MS=4min`, `maxDuration=300` côté Vercel). **Mais** persistance `sourcing_state` PAS faite en cas d'erreur pipeline (F-IMP-05). Reset signature OK (`resolveStartCurseur` cas `signature_changed`). |
| I. Cohérence métier | 🟡 | Cible adaptative `Math.max(dailyTarget * 3, 50)` (`sourcing-runner.ts:785`) conforme TODO §2. `exhausted_at` reset si filtres changent ✅ (`:265-272`). Fallback Recherche Entreprises préservé ✅ (`runAdaptiveSourcing:450-487`). **Mais** changement implicite du scope nocturne (F-IMP-03). |
| J. Risques de régression | 🟡 | Pas de breaking change visible côté pitch-gen / contact-enrichment / daily-list. **Mais** F-IMP-01 (modal ne reçoit pas les nouveaux stats) + F-IMP-03 (scope nocturne élargi). Migration 005 idempotente (`ADD COLUMN IF NOT EXISTS` partout) ✅. |

## Cohérence avec le TODO

### Décisions d'archi respectées

- ✅ Curseur dans `profiles.sourcing_state` JSONB (`sourcing-runner.ts:67-74`,
  migration 005 ligne 35-36).
- ✅ Mode adaptatif `max(daily_call_target × 3, 50)` (`sourcing-runner.ts:783-785`).
- ✅ Cap dur sur la boucle (`HARD_CAP_PAGES=50`, `HARD_CAP_DURATION_MS=240000`)
  pour respecter le timeout cron Vercel.
- ✅ Fallback Recherche Entreprises conservé (`sourcerEntreprisesFallback` intact,
  appelé dans `runAdaptiveSourcing:461-471` quand `SireneApiError` sur première page).
- ✅ Signature SHA-256 12 chars (`sourcing-mapping.ts:296-312`) — exactement
  conforme spec §3.3.
- ✅ Pagination curseur officielle INSEE (`curseur=*`, `curseurSuivant`,
  terminaison sur égalité — `sourcing.ts:427-590`).

### Acceptance criteria Wave 2 atteints

- ✅ Wave 2.1 : refactor `sourcerEntreprises` avec curseur, `excludeSirens`,
  `effectifTranches`, `codePostalRange`, retour enrichi (TODO §3 Wave 2.1).
- ✅ Wave 2.2 : boucle adaptative dans `sourcing-runner.ts`, état persisté
  (sauf F-IMP-05 sur les chemins d'erreur), logs structurés.
- ✅ Wave 2.3 : Zod schema explicite, refine cross-field, erreurs typées.
- 🟡 Wave 2.4 : badge « épuisé » + stat cards codés côté modal, mais la route
  ne sert pas les données nécessaires (F-IMP-01).
- 🔴 Wave 3.1 : pas encore livré (tests `sourcing.ts` / `sourcing-runner.ts`
  manquants — c'est le périmètre de l'agent test-engineer en Wave 3).

### DoD globale

- ✅ `npm run type-check` (0 erreur).
- ⚠️ `npm run lint` (interactif sur la première exécution — config Next 16
  migration ; pas un fail du code, mais à régler côté infra).
- 🔴 `npm run test` (passage non vérifiable tant que Wave 3.1 absente).
- ✅ Migration 005 idempotente, applicable localement.
- 🔴 Run sur compte à 540 prospects → > 50 nouveaux : non testable en review.
- 🟢 `agent_runs.logs` aura bien `sirene_total_available`, `sirene_pages_loaded`,
  `sirene_curseur_final`, breakdown new/updated (via `updateRunInDB` lignes 951-963).

## Risques résiduels à monitorer

1. **F-IMP-03 (scope nocturne)** : si l'option 3 est retenue (acter France
   entière), surveiller le volume de prospects sourcés par run en prod —
   un compte qui était à 540 Gironde pourrait passer à plusieurs milliers
   en une nuit, avec un coût ADEME × N (rappel : `verifierBegesAdeme` est
   appelée pour chaque établissement collecté, dans `enrichirProspect`).
2. **Rate limit ADEME Data Fair** : la boucle adaptative peut maintenant fetch
   jusqu'à 50 × 100 = 5 000 établissements en un run. Chaque étab. déclenche
   un fetch ADEME (`enrichAndScore` batch 20 + 1 fetch `verifierBegesAdeme` +
   1 fetch `rechercherTelephone` par étab). Pas de rate-limit explicite côté
   ADEME dans le code — à surveiller via 429.
3. **`sourcing_state.exhausted_at` reset à 7 jours** : si l'univers Sirene
   évolue plus vite (nouveaux établissements quotidiens), le refresh hebdo
   peut laisser passer 7 jours sans repartir. Constante `EXHAUSTED_RESET_DAYS`
   à ajuster si besoin (`sourcing-runner.ts:112`).
4. **Modal `window.location.reload()`** : si l'orchestrator du dashboard
   passe un jour en streaming/SSE, ce reload bouclera potentiellement la
   connexion. Migration future vers `router.refresh()` à prévoir.
5. **`computeFiltersSignature` ignore `excludeSirens`** : c'est intentionnel
   et documenté (`sourcing-mapping.ts:293`), mais signifie que deux users
   avec exactement les mêmes filtres mais des bases prospects différentes
   ont la même signature. Pas un bug (la signature est scopée à 1 user via
   `profiles.sourcing_state`), juste à garder en tête.

---

**Recommandation finale** : merger après fix F-IMP-01 + F-IMP-04 + F-IMP-05
(triviaux, ~15 min de code), arbitrer F-IMP-03 avec le pilote, et lancer
Wave 3.1 pour livrer les tests manquants avant `git push`.

---

## Wave 3 — Status des fixes

- ✅ **F-IMP-01 FIXED** (`app/api/agent/sourcing/route.ts:182-201`) — La réponse
  JSON expose désormais `prospectsQualified`, `totalAvailable`, `pagesLoaded`,
  `exhausted`, `curseurFinal`, `usedFallback`, `durationMs` (en plus du legacy
  `duration_ms`). La modal reçoit désormais toutes les données nécessaires.
- ✅ **F-IMP-04 FIXED** (`lib/agent/sourcing-runner.ts:56-89`, `:988-1000`) —
  `SourcingResult` étendu : `prospectsSourced`, `prospectsQualified`,
  `totalAvailable`, `pagesLoaded`, `exhausted`, `curseurFinal`, `usedFallback`
  ajoutés. `runSourcing` les renvoie en lisant `output.outcome.*` et
  `output.qualifiedCount`.
- ✅ **F-IMP-05 FIXED** (`lib/agent/sourcing-runner.ts:810-880`) — Boucle
  adaptative + enrich + score + upsert encapsulés dans un `try/finally`.
  `persistSourcingState` est appelé dans le `finally` dès que `outcome` est
  affecté (la boucle a au moins commencé une itération réussie). Garantit
  l'idempotence : un crash ADEME / upsert n'efface plus l'avancement du
  curseur Sirene.

Validation : `npm run type-check` ✅ — `npm run test` ✅ (73 tests passent).
