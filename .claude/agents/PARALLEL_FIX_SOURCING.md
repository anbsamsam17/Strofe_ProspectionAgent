---
name: parallel-fix-sourcing-france
description: Plan d'exécution parallèle (5 agents Opus 4.7) pour corriger le bug "Univers de recherche épuisé / 0 entreprises trouvées" et passer le défaut géographique de Gironde à France entière.
metadata:
  type: project
  status: in_progress
  triggered_by: samir.anbri@gmail.com
  triggered_at: 2026-05-12
---

# Plan de parallélisation — Fix "Univers de recherche épuisé"

## Symptôme

UI sourcing affiche `Univers de recherche épuisé — 0 entreprises trouvées au total avec ces filtres. Élargissez la région ou les effectifs pour découvrir plus de prospects` même quand l'utilisateur ne fournit aucun filtre.

## Cause racine

1. `lib/agent/sourcing-mapping.ts:151-152, 191-192, 277-279` — défaut "Gironde uniquement" appliqué silencieusement quand `targetRegion` est vide (commentaire `Default = Gironde to preserve legacy behavior`).
2. `lib/agent/sourcing.ts:632-653` (`sourcerEntreprisesFallback`) — hardcode `departement=33` et `tranche_effectif_salarie='21,22,31,32,41,42,51,52,53'` ; ignore les filtres reçus.
3. `lib/agent/sourcing-runner.ts:484-488` — appelle le fallback sans passer `filters.tranches` ni `filters.departements`.
4. `components/dashboard/sourcing-modal.tsx` — ne pré-remplit jamais le formulaire depuis `profiles.settings`. `targetRegion` reste `''` par défaut.
5. `lib/agent/sourcing.ts:466-483` — un 404 Sirene (univers vraiment vide) est confondu avec un `exhausted=true` (curseur consommé). UX trompeuse.

## Contrats d'interface partagés (à respecter par tous les agents)

### Contrat A — `SourcingOptions` (lib/agent/sourcing.ts)

Étendre l'interface avec deux nouveaux champs optionnels :

```ts
export interface SourcingOptions {
  maxResults?: number
  nafCodes?: string[]
  codePostalRange?: string
  excludeSirens?: Set<string>
  // NOUVEAUX
  effectifTranches?: string[]   // ex ['21','22','31','32','41','42','51','52','53']
  departements?: string[]        // ex ['33','75'] ; [] = France entière
}
```

Défauts dans `sourcerEntreprisesFallback` :
- `effectifTranches` absent → `['21','22','31','32','41','42','51','52','53']` (50+ salariés, identique au défaut actuel)
- `departements` absent OU vide `[]` → **PAS DE FILTRE `departement`** côté API (France entière)

### Contrat B — `SourcerEntreprisesResult` (lib/agent/sourcing.ts)

Ajouter un champ booléen `universeEmpty` au type de retour :

```ts
export type SourcerEntreprisesResult = {
  etablissements: SireneEtablissement[]
  curseur: string
  curseurSuivant: string
  totalAvailable: number
  pagesLoaded: number
  exhausted: boolean
  universeEmpty: boolean   // NOUVEAU — true ssi 404 Sirene sur la 1ère page
}
```

- `universeEmpty=true` ⟺ HTTP 404 reçu sur la première page (= aucune entreprise ne matche ces filtres)
- `exhausted=true && universeEmpty=false` ⟺ curseur consommé (pagination terminée, mais l'univers existait)

### Contrat C — `mapRegionToCodePostal('') → ['00000','99999']`

Quand `label` est vide/null/undefined, retourner **range nationale** (pas Gironde).
`mapRegionToDepartements('') → []` (pas de filtre département).
Pour un label **NON RECONNU** (ex. "Atlantide"), fallback **France entière** également (et non plus Gironde) — log warn conservé.

### Contrat D — `SourcingResult` + JSON route (sourcing-runner.ts + app/api/agent/sourcing/route.ts)

Ajouter `universeEmpty: boolean` au type `SourcingResult` exposé à l'UI :

```ts
export interface SourcingResult {
  runId: string
  prospectsSourced: number
  // ...existing fields
  exhausted: boolean
  universeEmpty: boolean    // NOUVEAU — propagé depuis outcome
  curseurFinal: string
  usedFallback: boolean
  duration_ms: number
}
```

Et dans `AdaptiveSourcingOutcome` :
```ts
universeEmpty: boolean   // remonté depuis sourcerEntreprises (1ère page)
```

### Contrat E — UI sourcing-modal.tsx

Distinguer trois états dans le bandeau :
- `universeEmpty=true` → "Aucune entreprise ne correspond à ces filtres. Élargissez effectifs, secteurs ou zone."
- `exhausted=true && universeEmpty=false` → "Univers épuisé pour ces filtres (toutes les entreprises ont déjà été sourcées). Tentez d'autres critères."
- défaut → pas de bandeau

Pré-remplir `formData` au mount/`isOpen=true` depuis `GET /api/profile` (champ `settings.target_sectors`, `settings.codes_postaux`).

---

## Partition par agent (fichiers exclusifs)

| # | Agent | Fichier(s) modifié(s) | Risque conflit |
|---|---|---|---|
| 1 | `agent-pipeline-engineer` | `lib/agent/sourcing-mapping.ts` | aucun |
| 2 | `external-api-integrator` | `lib/agent/sourcing.ts` + `.env.example` | aucun |
| 3 | `cron-watchdog` | `lib/agent/sourcing-runner.ts` | aucun |
| 4 | `ui-component-builder` | `components/dashboard/sourcing-modal.tsx` + `app/api/agent/sourcing/route.ts` | aucun |
| 5 | `test-engineer` | `lib/agent/__tests__/sourcing-mapping.test.ts` + nouveaux tests | dépend des 4 précédents |

Les agents 1-4 modifient des fichiers **disjoints** → parallélisation directe sans worktree.
L'agent 5 (tests) attend la fin des 4 autres avant de lancer `npm run test`.

---

## Vérification finale (orchestrateur)

```powershell
npm run lint
npm run type-check
npm run test
```

Tests qui doivent passer : `sourcing-mapping.test.ts`, `sourcing.test.ts`, `sourcing-runner.test.ts`.

Smoke test manuel :
```powershell
curl -X POST http://localhost:3000/api/agent/sourcing `
  -H "Content-Type: application/json" `
  -H "Cookie: sb-access-token=..." `
  -d '{}'
```
→ Réponse attendue : recherche France entière, plus de défaut Gironde, `universeEmpty` propagé.
