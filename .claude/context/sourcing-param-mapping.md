# Mapping UI → Sirene / Recherche Entreprises

> Spec produite par `beges-domain-expert` pour `fix/sourcing-pagination` (Wave 1, Task 1.2).
> Consommée par Wave 2 (`external-api-integrator` Task 2.1 + `agent-pipeline-engineer` Task 2.2 + `nextjs-route-architect` Task 2.3).
> **Aucune modification de code dans cette spec — uniquement la traduction des params UI vers les params API.**

---

## 0. Inventaire des params actuellement envoyés / attendus

| Param UI (`components/dashboard/sourcing-modal.tsx`) | Type envoyé | Param API (`app/api/agent/sourcing/route.ts:24-31`) | État actuel (`lib/agent/sourcing-runner.ts:277`) |
|---|---|---|---|
| `effectifMin` (input number 1-10000, défaut `50`) | `number` (positive int) | `effectifMin: z.number().int().positive().optional()` | **non transmis à `sourcerEntreprises`** |
| `effectifMax` (input number 1-10000, défaut `500`) | `number` (positive int) | `effectifMax: z.number().int().positive().optional()` | **non transmis** |
| `targetRegion` (input text, placeholder « 33 (Gironde) », `maxLength=5`) | `string` (code dept 2 chiffres typiquement) | `targetRegion: z.string().trim().min(1).optional()` | **non transmis** |
| `targetSectors` (cases à cocher, aplaties en codes NAF type `01.21Z`) | `string[]` (codes NAF avec point) | `targetSectors: z.array(z.string().trim().min(1)).optional()` | partiellement (option `nafCodes` existe dans `SourcingOptions` mais le runner n'achemine pas `targetSectors`) |

**Constantes hardcodées à remplacer côté Wave 2** :
- `TRANCHE_MIN = '21'` (`lib/agent/sourcing.ts:58`)
- `TRANCHE_MAX = '53'` (`lib/agent/sourcing.ts:59`)
- `CODE_POSTAL_QUERY = 'codePostalEtablissement:[33000 TO 33999]'` (`lib/agent/sourcing.ts:62`)
- `departement: '33'` en dur dans le fallback (`lib/agent/sourcing.ts:382`)
- `tranche_effectif_salarie: '21,22,31,32,41,42,51,52,53'` en dur dans le fallback (`lib/agent/sourcing.ts:384`)

---

## 1. Effectifs — mapping `(effectifMin, effectifMax)` → tranches INSEE

### 1.1 Référence officielle des tranches INSEE

> Variable `trancheEffectifsEtablissement` Sirene v3.11.
> Voir aussi la fonction inverse déjà existante `trancheToEffectif()` à `lib/agent/sourcing.ts:714-741`.

| Code tranche | Plage salariés |
|---|---|
| `NN` | Non précisé (à exclure par défaut) |
| `00` | 0 salarié |
| `01` | 1 à 2 |
| `02` | 3 à 5 |
| `03` | 6 à 9 |
| `11` | 10 à 19 |
| `12` | 20 à 49 |
| `21` | **50 à 99** |
| `22` | **100 à 199** |
| `31` | **200 à 249** |
| `32` | **250 à 499** |
| `41` | **500 à 999** (seuil obligation BEGES métro) |
| `42` | 1 000 à 1 999 |
| `51` | 2 000 à 4 999 |
| `52` | 5 000 à 9 999 |
| `53` | 10 000+ |

### 1.2 Table de correspondance plage humaine → tranches à inclure

Règle : une tranche INSEE est incluse ssi son intervalle `[trMin, trMax]` **chevauche** la plage utilisateur `[effectifMin, effectifMax]`.
Algébriquement : `inclure(tr) ⇔ trMin ≤ effectifMax ET trMax ≥ effectifMin`.

| effectifMin | effectifMax | Tranches INSEE à inclure (CSV pour fallback) | Range Lucene équivalent |
|---|---|---|---|
| 0 | 0 | `00` | `[00 TO 00]` |
| 0 | 9 | `00,01,02,03` | `[00 TO 03]` |
| 1 | 9 | `01,02,03` | `[01 TO 03]` |
| 1 | 49 | `01,02,03,11,12` | (liste, pas range — `[01 TO 12]` couvre aussi 03 → 11 mais le code `04..10` n'existe pas, donc `[01 TO 12]` est sûr) |
| 10 | 49 | `11,12` | `[11 TO 12]` |
| 10 | 199 | `11,12,21,22` | `[11 TO 22]` |
| 20 | 49 | `12` | `[12 TO 12]` |
| 20 | 199 | `12,21,22` | `[12 TO 22]` |
| **50** | **199** | `21,22` | `[21 TO 22]` |
| **50** | **499** (cas test principal) | `21,22,31,32` | `[21 TO 32]` |
| 50 | 999 | `21,22,31,32,41` | `[21 TO 41]` |
| 50 | 10000 | `21,22,31,32,41,42,51,52,53` | `[21 TO 53]` (= comportement actuel hardcodé) |
| 100 | 499 | `22,31,32` | `[22 TO 32]` |
| 200 | 499 | `31,32` | `[31 TO 32]` |
| 200 | 999 | `31,32,41` | `[31 TO 41]` |
| 250 | 999 | `32,41` | `[32 TO 41]` |
| 500 | 999 | `41` | `[41 TO 41]` |
| 500 | 10000 | `41,42,51,52,53` | `[41 TO 53]` |
| 1000 | 10000 | `42,51,52,53` | `[42 TO 53]` |
| 5000 | 10000 | `52,53` | `[52 TO 53]` |
| 10000 | 99999 | `53` | `[53 TO 53]` |

**Note importante sur le range Lucene** : les codes tranche sont des **chaînes triables lexicographiquement** (`00 < 01 < 02 < 03 < 11 < 12 < 21 < 22 < 31 < 32 < 41 < 42 < 51 < 52 < 53`). Un range Lucene `[A TO B]` filtre lexicographiquement — il **inclut** des codes inexistants intermédiaires (ex. `04` à `10`, `13` à `20`, etc.) **sans effet** puisque l'INSEE n'émet jamais ces valeurs. Donc `[01 TO 12]` est strictement équivalent à `(01 OR 02 OR 03 OR 11 OR 12)` côté résultats. À privilégier pour la concision du `q`.

### 1.3 Fonction de conversion (à implémenter en Wave 2.1)

Signature suggérée pour `external-api-integrator` :

```ts
/**
 * Convertit une plage d'effectifs humaine en liste de codes tranche INSEE.
 * @param min effectifMin (>= 0, entier)
 * @param max effectifMax (>= min, entier)
 * @returns liste triée des codes tranche couvrant la plage. Liste vide possible.
 */
function mapEffectifToTranches(min: number, max: number): string[] {
  const TRANCHES: Array<[string, number, number]> = [
    ['00', 0, 0],
    ['01', 1, 2],
    ['02', 3, 5],
    ['03', 6, 9],
    ['11', 10, 19],
    ['12', 20, 49],
    ['21', 50, 99],
    ['22', 100, 199],
    ['31', 200, 249],
    ['32', 250, 499],
    ['41', 500, 999],
    ['42', 1000, 1999],
    ['51', 2000, 4999],
    ['52', 5000, 9999],
    ['53', 10000, 99999],
  ]
  return TRANCHES
    .filter(([, trMin, trMax]) => trMin <= max && trMax >= min)
    .map(([code]) => code)
}

/** Construit le filtre Lucene Sirene à partir des tranches. */
function tranchesToLucene(tranches: string[]): string {
  if (tranches.length === 0) {
    throw new Error('tranchesToLucene: au moins une tranche requise')
  }
  // Sirene accepte un range lexicographique — sûr ici (cf. note §1.2)
  const sorted = [...tranches].sort()
  return `trancheEffectifsEtablissement:[${sorted[0]} TO ${sorted[sorted.length - 1]}]`
}

/** Construit le param fallback Recherche Entreprises. */
function tranchesToFallbackParam(tranches: string[]): string {
  return tranches.join(',')   // ex. "21,22,31,32"
}
```

### 1.4 Edge cases — décisions documentées

| Cas | Décision | Justification |
|---|---|---|
| `effectifMin` ou `effectifMax` absent (Zod `.optional()`) | Fallback sur défauts actuels : `min=50, max=99999` (équivalent `[21 TO 53]`) | Préserve le comportement legacy quand l'UI n'envoie rien. Conforme à la cible BEGES (50+ salariés, cf. `beges-glossary.md`). |
| `effectifMin === 0` | Inclure `00` mais **PAS** `NN` (non précisé) | `NN` introduit du bruit (établissements sans effectif déclaré, souvent dormants). Conforme au filtre `etatAdministratifEtablissement:A` déjà appliqué (`lib/agent/sourcing.ts:233`). |
| `effectifMin > effectifMax` | **Erreur de validation à 400** côté route API (Task 2.3) | Refaire la check de cohérence côté UI (déjà fait `sourcing-modal.tsx:133`) ET serveur (Zod `refine`). |
| `effectifMin < 0` ou non-entier | Rejeté par Zod (`z.number().int().positive()`) — pour `0` Zod doit être assoupli en `.nonnegative()` si on veut accepter `effectifMin=0` côté UI (actuellement l'input refuse car `min={1}`) | À garder en mémoire pour Phase 2 ; pour Wave 1 on n'autorise pas `effectifMin=0` (cohérent avec l'UI). |
| `effectifMax > 99999` | Borner à `99999` (couvert par tranche `53`) | Tranche `53` couvre 10 000+, pas de plus grand. |
| Tranche calculée vide (cas impossible avec une plage valide) | Throw côté Wave 2.1 — signe d'un bug dans le mapping | Test 1.3 doit garantir que ce cas n'arrive pas. |

---

## 2. Géographie — mapping `targetRegion` → Lucene + fallback

### 2.1 Format d'entrée actuel

Le placeholder de la modal (`sourcing-modal.tsx:379`) annonce : `« Ex : 33 (Gironde), 75 (Paris), 69 (Rhône) »` avec `maxLength=5`. L'utilisateur saisit donc principalement un **code département à 2 chiffres** (ou 3 pour DROM : 971, 972, 973, 974, 976), pas un label région.

**Décision** : la Wave 2 doit accepter trois formats en entrée pour `targetRegion`, dans l'ordre de priorité :
1. **Code département 2-3 chiffres** (`/^\d{2,3}$/`) → mapping direct (cas dominant via UI actuelle)
2. **Label texte connu** (ex. `Gironde`, `Bordeaux`, `Nouvelle-Aquitaine`, `Île-de-France`, `France`) → résolu via la table ci-dessous (insensible à la casse, accents normalisés)
3. **Vide / `France` / non reconnu** → pas de filtre géographique (univers national)

### 2.2 Table de mapping label → départements

| Label canonique | Synonymes acceptés (lowercase, sans accents) | Départements (INSEE) | Range CP Lucene principal | Param fallback `departement` |
|---|---|---|---|---|
| Gironde | `gironde`, `33` | 33 | `[33000 TO 33999]` | `33` |
| Bordeaux (ville) | `bordeaux` | 33 (CP 33000-33300 + 33800) | liste explicite : `(33000 OR 33100 OR 33200 OR 33300 OR 33800)` | `33` (l'API gouv n'a pas de filtre commune ; on accepte la sur-couverture Gironde puis filtrage côté code via `r.siege.code_postal`) |
| Dordogne | `dordogne`, `24` | 24 | `[24000 TO 24999]` | `24` |
| Landes | `landes`, `40` | 40 | `[40000 TO 40999]` | `40` |
| Lot-et-Garonne | `lot-et-garonne`, `lot et garonne`, `47` | 47 | `[47000 TO 47999]` | `47` |
| Pyrénées-Atlantiques | `pyrenees-atlantiques`, `pyrenees atlantiques`, `64` | 64 | `[64000 TO 64999]` | `64` |
| Charente | `charente`, `16` | 16 | `[16000 TO 16999]` | `16` |
| Charente-Maritime | `charente-maritime`, `charente maritime`, `17` | 17 | `[17000 TO 17999]` | `17` |
| Corrèze | `correze`, `19` | 19 | `[19000 TO 19999]` | `19` |
| Creuse | `creuse`, `23` | 23 | `[23000 TO 23999]` | `23` |
| Deux-Sèvres | `deux-sevres`, `deux sevres`, `79` | 79 | `[79000 TO 79999]` | `79` |
| Vienne | `vienne`, `86` | 86 | `[86000 TO 86999]` | `86` |
| Haute-Vienne | `haute-vienne`, `haute vienne`, `87` | 87 | `[87000 TO 87999]` | `87` |
| **Nouvelle-Aquitaine** (région) | `nouvelle-aquitaine`, `nouvelle aquitaine`, `naq` | 16, 17, 19, 23, 24, 33, 40, 47, 64, 79, 86, 87 | `(codePostalEtablissement:[16000 TO 16999] OR [17000 TO 17999] OR [19000 TO 19999] OR [23000 TO 23999] OR [24000 TO 24999] OR [33000 TO 33999] OR [40000 TO 40999] OR [47000 TO 47999] OR [64000 TO 64999] OR [79000 TO 79999] OR [86000 TO 86999] OR [87000 TO 87999])` | `16,17,19,23,24,33,40,47,64,79,86,87` |
| Paris | `paris`, `75` | 75 | `[75000 TO 75999]` | `75` |
| Rhône | `rhone`, `69` | 69 | `[69000 TO 69999]` | `69` |
| **Île-de-France** (région) | `ile-de-france`, `ile de france`, `idf` | 75, 77, 78, 91, 92, 93, 94, 95 | range multiple sur ces CP | `75,77,78,91,92,93,94,95` |
| **France** entière | `france`, `fr`, `` (vide) | tous | (pas de filtre `codePostalEtablissement`) | (pas de param `departement`) |

**DROM (à documenter pour future support)** : 971 Guadeloupe, 972 Martinique, 973 Guyane, 974 La Réunion, 976 Mayotte. CP sur 5 chiffres `971xx`–`976xx`. **Rappel BEGES** : seuil obligation **250 salariés** en DROM (vs 500 métro) — voir `beges-glossary.md`. Non couvert par Wave 1 mais à garder en tête pour Wave 2.3 (Zod) afin de ne pas rejeter `targetRegion="971"`.

### 2.3 Fonction de résolution (à implémenter en Wave 2.1)

```ts
type GeoFilter = {
  /** Filtre Lucene pour Sirene primaire. Chaîne vide si pas de filtre. */
  lucene: string
  /** Liste de codes département CSV pour le fallback Recherche Entreprises. Chaîne vide si pas de filtre. */
  departementCsv: string
  /** Codes département (utile pour la signature de filtres §3). */
  departements: string[]
}

function resolveGeoFilter(targetRegion: string | undefined): GeoFilter {
  if (!targetRegion?.trim()) {
    return { lucene: '', departementCsv: '', departements: [] }
  }
  const raw = targetRegion.trim()
  // 1. Code département direct (2 ou 3 chiffres)
  if (/^\d{2,3}$/.test(raw)) {
    return buildFilterFromDepts([raw])
  }
  // 2. Label connu (normalisé)
  const normalized = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const depts = LABEL_TO_DEPTS[normalized]  // table §2.2
  if (depts) {
    return buildFilterFromDepts(depts)
  }
  // 3. Non reconnu → log warning, fallback Gironde (compat historique)
  console.log(JSON.stringify({
    level: 'warn',
    module: 'sourcing',
    msg: `targetRegion non reconnue: "${raw}" — fallback Gironde`,
  }))
  return buildFilterFromDepts(['33'])
}
```

### 2.4 Edge cases géo — décisions documentées

| Cas | Décision | Justification |
|---|---|---|
| `targetRegion` **absent** (undefined/null/vide string) | **Fallback Gironde** (`['33']` / `['33000','33999']`) — comportement legacy préservé | **Par défaut (params absents) → Gironde, comportement legacy préservé. Phase 2 = élargissement explicite.** L'orchestrator nocturne (`lib/agent/orchestrator.ts`) appelle `runPipelineSourcing` sans `targetRegion` ; retourner une range nationale ici élargirait silencieusement l'univers à France entière, ce qui n'est pas la décision du TODO Wave 2. Voir F-IMP-03 du code review Wave 2. |
| `targetRegion="France"` ou `"fr"` (label **explicite**) | Pas de filtre `codePostalEtablissement` ni `departement` (univers national) | L'élargissement géographique doit être un choix utilisateur explicite (UI ou setting), pas un défaut implicite. Attention au volume : préciser cap `maxResults`. |
| `targetRegion` non reconnue (ex. `"Atlantide"`) | Log warning + fallback Gironde (`33`) | Compat avec le comportement actuel (Gironde) ; permet de ne pas casser des intégrations existantes. Alternative envisagée : retourner erreur 400 — rejetée car trop strict pour un MVP. À ré-évaluer si on observe des fallbacks fréquents en prod. |
| Code département `"33"` saisi en tant que texte | Traité comme code département (§2.3 cas 1) | Compatible avec l'UI actuelle. |
| Label `"Bordeaux"` | Sur-couverture Gironde côté fallback (l'API gouv ne sait pas filtrer commune) + filtrage CP côté code | Pas d'impact résultats — juste plus de bande passante. Acceptable. |
| Plusieurs régions (ex. `"33,75"`) | **Non supporté** en Wave 1. Wave 2.3 (Zod) doit rejeter (400). Si demande forte plus tard → Phase 2. | Évite la complexité d'un parseur multi-régions à ce stade. |

---

## 3. Signature de filtres (invalidation curseur)

### 3.1 Contexte

Le curseur Sirene persisté dans `profiles.sourcing_state.curseur` (Task 1.1) reflète une **position dans un univers défini par un set de filtres**. Si l'utilisateur change ses filtres entre deux runs, repartir du curseur précédent saute des résultats du nouveau périmètre (ou retourne des résultats incohérents si le curseur appartient à un autre univers).

**Solution** : stocker à côté du curseur une **signature** du set de filtres ; à chaque début de run, comparer la signature courante à la signature stockée ; si différentes → `curseur = '*'`.

### 3.2 Composition de la signature

Inclure dans le hash :
1. **Liste triée des tranches d'effectifs** (résultat de `mapEffectifToTranches`)
2. **Liste triée des codes département** (résultat de `resolveGeoFilter().departements`) — on signe les départements, pas les ranges CP bruts (équivalent sémantique, plus stable)
3. **Liste triée des codes NAF normalisés** (sans point, uppercase — comme `cleanedNafCodes` dans `lib/agent/sourcing.ts:225-227`)

**Exclus de la signature** :
- `maxResults` (ne change pas l'univers, juste la taille de l'échantillon)
- `excludeSirens` (varie à chaque run, ce n'est pas un filtre d'univers)

### 3.3 Algorithme

```ts
import { createHash } from 'crypto'

function buildFiltersSignature(args: {
  tranches: string[]   // ex ['21','22','31','32']
  departements: string[]  // ex ['33'] ou [] pour France
  nafCodes: string[]   // ex ['0121Z','3030Z',...] (normalisés)
}): string {
  const tranchesPart = [...args.tranches].sort().join(',')
  const deptsPart = [...args.departements].sort().join(',')
  const nafPart = [...args.nafCodes].sort().join(',')
  const payload = `${tranchesPart}|${deptsPart}|${nafPart}`
  return createHash('sha256').update(payload).digest('hex').slice(0, 12)
}
```

### 3.4 Workflow d'invalidation (à coder dans `sourcing-runner.ts`, Wave 2.2)

```
1. Charger profiles.sourcing_state -> { curseur, filters_signature, last_total, exhausted_at }
2. Calculer signatureCurrent = buildFiltersSignature(...)
3. Si filters_signature !== signatureCurrent :
     curseur = '*'             # reset
     exhausted_at = null
     log info "filters signature changed → curseur reset"
4. Si exhausted_at IS NOT NULL et < 7 jours :
     log info "universe exhausted recently → reset curseur to refresh"
     curseur = '*'
5. Lancer la boucle adaptative avec ce curseur de départ
6. À la fin du run, persister :
     curseur = curseurSuivant
     filters_signature = signatureCurrent
     last_total = headerTotalFromLastPage
     exhausted_at = (curseurSuivant === curseurPrecedent) ? now() : null
```

### 3.5 Stockage

JSONB dans `profiles.sourcing_state` (migration 005, Task 1.1) :

```json
{
  "curseur": "AoEpOTk5...",
  "curseur_suivant": "AoEpOTk5...",
  "filters_signature": "a1b2c3d4e5f6",
  "last_total": 537,
  "exhausted_at": null,
  "last_run_at": "2026-05-11T22:00:00Z"
}
```

---

## 4. NAF — comportement Wave 1

### 4.1 Pas de changement de logique

La liste `NAF_PRIORITAIRES` (41 codes, `lib/agent/sourcing.ts:25-48`) reste le défaut. Si l'UI envoie `targetSectors` non vide → utilisé tel quel via l'option existante `nafCodes` (déjà câblée à `lib/agent/sourcing.ts:213`).

### 4.2 Format attendu

L'UI envoie les codes NAF **avec point** (ex. `01.21Z`). C'est cohérent avec le format stocké en constantes (`NAF_PRIORITAIRES` ligne 25-48) et avec l'API fallback (qui veut le format avec point, `lib/agent/sourcing.ts:381`). L'API Sirene Lucene exige le format **sans point** (`activitePrincipaleEtablissement:0121Z`) — la conversion est déjà faite via `replace('.', '')` à la ligne 226. **Aucun changement requis en Wave 2.1**.

### 4.3 Note pour Wave 2 — dette technique à signaler

`NAF_PRIORITAIRES` est dupliqué entre `lib/agent/sourcing.ts:25-48` et (probablement) `lib/agent/sourcing-runner.ts` ou `orchestrator.ts` — à vérifier par `agent-pipeline-engineer` en Wave 2.2 et à dédupliquer en exportant une seule source de vérité (par exemple depuis `lib/agent/sourcing.ts`). Pas bloquant pour Wave 1.

### 4.4 Edge cases NAF

| Cas | Décision |
|---|---|
| `targetSectors` vide ou absent | Fallback sur `NAF_PRIORITAIRES` (comportement actuel) |
| `targetSectors` avec doublons | Dédupliquer côté `external-api-integrator` avant envoi |
| `targetSectors` avec codes invalides (regex `/^\d{2}\.\d{2}[A-Z]$/`) | Rejet 400 côté Task 2.3 (Zod `refine`) — refuser plutôt que silently ignorer |
| Casse incorrecte (`01.21z`) | Normaliser en uppercase côté Wave 2.1 (déjà fait à `lib/agent/sourcing.ts:226`) |

---

## 5. Cas de test pour `test-engineer` (Task 1.3)

Tableau de test à matérialiser en fixtures + tests Vitest.

| # | Input UI | Tranches attendues | Lucene effectif attendu | Lucene géo attendu | Fallback `tranche_effectif_salarie` | Fallback `departement` | Signature filtres (déterministe pour ce set NAF=défaut) |
|---|---|---|---|---|---|---|---|
| 1 | `effectifMin=50, effectifMax=499, targetRegion="Gironde"` | `[21,22,31,32]` | `trancheEffectifsEtablissement:[21 TO 32]` | `codePostalEtablissement:[33000 TO 33999]` | `21,22,31,32` | `33` | à snapshoter |
| 2 | `effectifMin=50, effectifMax=499, targetRegion="33"` | idem #1 | idem #1 | idem #1 | idem #1 | idem #1 | **identique à #1** (cohérence label/code) |
| 3 | `effectifMin=200, effectifMax=10000, targetRegion="Nouvelle-Aquitaine"` | `[31,32,41,42,51,52,53]` | `trancheEffectifsEtablissement:[31 TO 53]` | `(codePostalEtablissement:[16000 TO 16999] OR [17000 TO 17999] OR [19000 TO 19999] OR [23000 TO 23999] OR [24000 TO 24999] OR [33000 TO 33999] OR [40000 TO 40999] OR [47000 TO 47999] OR [64000 TO 64999] OR [79000 TO 79999] OR [86000 TO 86999] OR [87000 TO 87999])` | `31,32,41,42,51,52,53` | `16,17,19,23,24,33,40,47,64,79,86,87` | à snapshoter |
| 4 | `effectifMin=10, effectifMax=49, targetRegion="Île-de-France"` | `[11,12]` | `trancheEffectifsEtablissement:[11 TO 12]` | range multi sur 75,77,78,91,92,93,94,95 | `11,12` | `75,77,78,91,92,93,94,95` | à snapshoter |
| 5 | `effectifMin=500, effectifMax=10000, targetRegion=""` (France entière) | `[41,42,51,52,53]` | `trancheEffectifsEtablissement:[41 TO 53]` | **(pas de filtre CP)** | `41,42,51,52,53` | **(pas de param departement)** | à snapshoter |
| 6 | `effectifMin=50, effectifMax=199, targetRegion="75"` (Paris seul) | `[21,22]` | `trancheEffectifsEtablissement:[21 TO 22]` | `codePostalEtablissement:[75000 TO 75999]` | `21,22` | `75` | à snapshoter |
| 7 | `effectifMin=50, effectifMax=499, targetRegion="Atlantide"` (non reconnu) | `[21,22,31,32]` | idem #1 (fallback Gironde) | idem #1 | idem #1 | idem #1 | **identique à #1** ; **+ log warn** émis |
| 8 | `effectifMin=600, effectifMax=400, targetRegion="33"` (min > max) | n/a | n/a | n/a | n/a | n/a | **erreur 400 Zod côté Task 2.3** |
| 9 | Params absents (body `{}`) | `[21,22,31,32,41,42,51,52,53]` (défaut legacy 50+) | `[21 TO 53]` | `[33000 TO 33999]` (défaut legacy Gironde) | `21,22,31,32,41,42,51,52,53` | `33` | à snapshoter — **signature legacy** à figer comme baseline |
| 10 | `effectifMin=50, effectifMax=499, targetRegion="Gironde"`, **2e run consécutif avec filtres identiques** | idem #1 | idem #1 | idem #1 | idem #1 | idem #1 | **signature identique → curseur NON réinitialisé** (test de non-régression sur l'invalidation) |
| 11 | Run avec filtres #1 puis run avec filtres #6 | n/a | n/a | n/a | n/a | n/a | **signatures différentes → curseur réinitialisé à `*` au 2e run** |

**Note pour `test-engineer`** : les cas #1, #10 et #11 testent ensemble la logique de signature de filtres (§3) — c'est la garantie de correction du bug "plateau 540". Les cas #2 et #7 testent la résolution de label. Les cas #8 et #9 testent les bornes Zod et le défaut legacy.

---

## 6. Synthèse — checklist pour les agents Wave 2

| Agent | Doit lire | Doit implémenter |
|---|---|---|
| `external-api-integrator` (2.1) | §1.3, §2.3, §3.3, §4 | `mapEffectifToTranches`, `tranchesToLucene`, `tranchesToFallbackParam`, `resolveGeoFilter`, `buildFiltersSignature`. Signature de `sourcerEntreprises` étendue à `{ effectifTranches, codePostalRange, departementCsv, excludeSirens, curseur }`. |
| `agent-pipeline-engineer` (2.2) | §3.4, §4.3, §5 | Workflow chargement/persistance `sourcing_state`, calcul signature, boucle adaptative. Déduplication des constantes NAF (cleanup §4.3). |
| `nextjs-route-architect` (2.3) | §0, §1.4, §2.4, §4.4 | Zod `refine` cohérence `effectifMin ≤ effectifMax`, validation format NAF, validation `targetRegion` (regex `/^\d{2,3}$|^[a-zà-ÿ\-\s']+$/i`, max 30 chars), transmission propre à `runSourcing`. |
| `test-engineer` (1.3 — déjà en cours) | §5 | Fixtures couvrant les 11 cas du tableau §5. |

---

**Statut** : ✅ Spec figée pour Wave 1.2. Toute modification ultérieure doit être annoncée dans `.claude/TODO-sourcing-fix.md` avec un changelog daté.
