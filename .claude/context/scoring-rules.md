# Scoring composite — barème 0-100

Fichier source : `lib/agent/scoring.ts`. Le score est calculé à la phase 4 du pipeline, persisté dans `prospects.score_priorite` et décomposé dans `prospects.score_details`.

## Barème exact

| Critère                              | Constante                     | Points |
|--------------------------------------|-------------------------------|--------|
| Obligation BEGES (> 500 sal.)        | `POINTS_OBLIGATION_BEGES`     | **+30** |
| Secteur prioritaire (NAF stricte)    | `POINTS_SECTEUR_PRIORITAIRE`  | **+20** |
| Aucun BEGES jamais publié            | `POINTS_BEGES_NON_PUBLIE`     | **+20** |
| BEGES publié mais expiré (> 4 ans)   | `POINTS_BEGES_EXPIRE`         | **+15** |
| Signaux d'intention RSE (cumul cap)  | `POINTS_SIGNAUX_INTENTION`    | **+15 max** |
| Taille entreprise (proportionnel)    | `POINTS_TAILLE_MAX`           | **+10 max** |
| Contact téléphone trouvé             | `POINTS_CONTACT_TELEPHONE`    | **+5** |
| Pénalité déjà contacté               | `PENALITE_DEJA_CONTACTE`      | **-20** |
| Pénalité rejeté                      | `PENALITE_REJETE`             | **-50** |
| **Total max théorique**              |                               | **100** |

Le score est clampé `[0, 100]` après somme.

### Détail BEGES (3 niveaux, exclusifs)

- `beges_publie = false` → **+20** (cible principale, prospect vierge)
- `beges_publie = true ET beges_valide = false` → **+15** (renouvellement obligatoire imminent)
- `beges_publie = true ET beges_valide = true` → **+0** (à jour, peu urgent)

### Détail taille (sur `effectif_max`)

| Tranche               | Points |
|-----------------------|--------|
| 200-499 sal.          | 3 |
| 500-999 sal.          | 6 |
| 1 000-4 999 sal.      | 8 |
| ≥ 5 000 sal.          | 10 |

### Détail signaux

`prospect.signaux` est un array `[{type, date, url, weight}]`. On somme les `weight` jusqu'au plafond `POINTS_SIGNAUX_INTENTION` (15). Si un signal n'a pas de `weight` il vaut 0.

## Seuils dérivés

| Constante | Valeur | Usage |
|-----------|--------|-------|
| `SCORE_QUALIFICATION_SEUIL` (orchestrator) | **20** | Score min pour passer `statut='qualified'` |
| `SEUIL_PRIORITE_HAUTE` (scoring) | **60** | `priorite='haute'` dans daily_list_items |
| `SEUIL_PRIORITE_NORMALE` (scoring) | **30** | ≥30 → `normale`, sinon `basse` |

`determinerPriorite(score)` est appelée à la construction de la daily list (phase 7).

## Ordre de priorisation lors du `selection`

À la phase 5, la requête `prospects` :
1. Filtre `statut IN ('sourced','qualified')`.
2. Filtre `beges_publie=false OR beges_valide=false`.
3. ORDER BY `score_priorite DESC`.
4. Exclut les `prospect_id` déjà dans la daily_list du jour.
5. LIMIT `daily_call_target` (15 par défaut).

Le score haut = entreprise **obligée + non-conforme + secteur prio + signaux RSE**. C'est la combinaison qui fait monter.

## Profil de score haut typique (exemple ~90 pts)

```
Entreprise viticole 800 salariés à Bordeaux, jamais publié de BEGES,
téléphone trouvé, 2 signaux (offre emploi RSE récente + article presse).
   obligation_beges       +30
   secteur_prioritaire    +20  (NAF 01.21Z)
   beges_non_publie       +20
   signaux_intention      +15  (capé)
   taille_entreprise       +6  (500-999)
   contact_telephone       +5
   --                     ---
   total                   96 / 100
```

## Comment ajuster sans casser

1. **Ajouter un critère** : créer une constante `POINTS_X`, l'ajouter dans `_computeDetails()`, dans le type `ScoreDetails` (`lib/types.ts`), et dans le commentaire SQL de `prospects.score_details`. Ajuster pour que `MAX(somme positive) ≤ 100`.
2. **Modifier un poids** : changer la constante, lancer Vitest (`lib/agent/__tests__/scoring*.test.ts` si présent — à vérifier) pour valider le profil de scores.
3. **Ajouter un secteur prio** : ajouter le code NAF dans le `Set` `NAF_PRIORITAIRES` (scoring.ts) ET dans `NAF_PRIORITAIRES_DEFAULT` (orchestrator.ts) si on veut aussi le sourcer par défaut.
4. **Garder l'invariant somme ≤ 100** : sinon le clamp masquera des écarts entre prospects haut de tableau.
5. **Versionner** : tout changement notable au barème → entry dans `memory/hindsight.md` (raison, impact attendu).
