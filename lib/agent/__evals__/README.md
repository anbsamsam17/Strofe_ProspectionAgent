# Eval harness — Scoring commercial Gemini

> « Je mesure et j'améliore un système LLM. »

Ce harness évalue la **qualité du scoring commercial** produit par
`scoreLeadAvecGemini` (`lib/agent/gemini-scoring.ts`, modèle `gemini-2.0-flash`).
Pour chaque entreprise, le modèle renvoie `{ interet_score: 0-100, raisons: string[3-5] }`.
Le harness vérifie que ce score et ces raisons sont **justes, conformes et
utilisables en appel**, sur un jeu de cas de référence (« golden set »).

## Lancer

```bash
npm run eval:llm
```

- **Sans `GEMINI_API_KEY`** → mode **offline déterministe** (CI). Aucun appel
  réseau. Passe en vert si les fixtures et le builder de prompt sont sains.
- **Avec `GEMINI_API_KEY`** → mode **live** en plus : appelle le vrai modèle sur
  chaque cas, calcule les métriques et écrit `last-report.json`.

```bash
# Run live (réel, consomme du quota Gemini)
GEMINI_API_KEY=xxxxx npm run eval:llm   # bash
$env:GEMINI_API_KEY='xxxxx'; npm run eval:llm   # PowerShell
```

> Le harness vit dans des fichiers `*.eval.ts` collectés par
> `vitest.evals.config.ts` (include dédié). Il n'est **pas** ramassé par
> `npm run test` ni compté dans la couverture — un run d'éval (potentiellement
> réseau) reste isolé de la CI unitaire.

## Le golden set

`lib/agent/__fixtures__/golden-prospects.json` — 18 entreprises plausibles
couvrant tout le spectre commercial, **sans aucune PII** (jamais de
`contact_email` / `contact_telephone` / `contact_nom`) :

| Profil | Score attendu |
|---|---|
| Grande (> 500) soumise, BEGES jamais publié, secteur lourd | très chaud (80-100) |
| Grande soumise, BEGES expiré (> 4 ans) | chaud (70-95) |
| Grande soumise, BEGES à jour conforme | froid/tiède (25-60) |
| Moyenne (250-500) hors obligation | tiède (35-65) |
| Petite / micro hors obligation | froid (0-30) |

Chaque cas porte :

- `input` : un `GeminiProspectInput` réel (le `Pick` du `Prospect`, sans PII).
- `expected_score_range: [min, max]` : la fourchette de score acceptable. La
  métrique d'erreur (MAE) se mesure contre le **centre** de cette fourchette.
- `expected_reason_properties` : propriétés sémantiques attendues des raisons
  (voir ci-dessous).

## Métriques (mode live)

| Métrique | Définition |
|---|---|
| **MAE** | Erreur absolue moyenne entre `interet_score` et le centre de `expected_score_range`. Plus bas = mieux. Seuil indicatif : < 25 pts. |
| **Within-range** | % de cas dont le score tombe dans `[min, max]`. |
| **Conformité des raisons** | % de propriétés attendues effectivement vérifiées sur l'ensemble des cas (mentions taille/secteur/BEGES/signaux, absence d'alarmisme). |
| **Respect de l'ordre** | % de cas où un argument **gain (ROI/image)** précède l'argument **légal** dans la liste des raisons — règle métier non négociable (cf. `.claude/rules/llm-prompts.md`). |

Le rapport est imprimé en console **et** écrit dans
`lib/agent/__evals__/last-report.json` (ignoré côté commit si besoin, c'est un
artefact d'observation).

### Comment les propriétés des raisons sont vérifiées

On ne peut pas exiger un wording exact d'un LLM. Le harness mesure des
**propriétés sémantiques** via des dictionnaires de marqueurs lexicaux FR
(ROI/image, légal, alarmisme, taille, état BEGES) :

- `mentions_taille_ou_effectif` / `mentions_secteur` / `mentions_beges_state` /
  `mentions_signaux` : au moins une raison référence l'axe attendu.
- `roi_or_image_before_legal` : la **première** raison contenant un marqueur
  gain apparaît **avant** la première raison contenant un marqueur légal.
- `no_alarmism` : aucune raison ne contient de vocabulaire alarmiste
  (« urgent », « sous peine », « avant qu'il ne soit trop tard »…).

## Mode offline (CI) — ce qui est garanti sans réseau

1. **Intégrité du golden set** : 15-20 cas, ids uniques, fourchettes valides
   (0-100, min < max), couverture des extrêmes (≥ 1 très chaud, ≥ 1 froid),
   **zéro PII** dans les inputs.
2. **Builder de prompt réel** (`_internal.buildUserPrompt`) : présence des faits
   réglementaires figés (`L. 229-25`, seuil `500`), reflet correct de l'état
   BEGES (obligation, jamais publié, expiré), et **aucune fuite de PII**
   (regex téléphone / email).
3. **Heuristiques du harness** validées sur des **sorties simulées** : un output
   parfait score 100 %, une inversion d'ordre est détectée, l'alarmisme est
   détecté, un score hors fourchette est rejeté, et le **schéma Zod réel** du
   module accepte/rejette correctement.

## LLM-as-judge (bonus, stub documenté)

Une alternative aux heuristiques lexicales : un second appel Gemini joue le
**juge** et note chaque jeu de raisons (spécificité, ordre des piliers, absence
d'alarmisme) en JSON structuré + Zod. Capte mieux la nuance, mais coûte un appel
de plus et demande une calibration. **Documenté mais non câblé** par défaut pour
garder la CI hors réseau (voir le bloc en bas de `gemini-scoring.eval.ts`).

## Ajouter un cas

1. Ajouter une entrée dans `golden-prospects.json` :
   - un `input` plausible (entreprise réaliste, **sans PII**) ;
   - `expected_score_range` cohérent avec la grille de scoring du prompt
     (cf. `buildUserPrompt` : 80-100 très chaud, 60-79 intéressant,
     40-59 tiède, 0-39 froid) ;
   - `expected_reason_properties` adaptées au profil.
2. `npm run eval:llm` (offline) doit rester vert : le nouvel input est
   automatiquement validé (Zod, prompt, PII).
3. En live, vérifier que le cas ne fait pas exploser la MAE — sinon, soit le
   range est mal calibré, soit c'est une vraie régression du prompt à traiter
   (cf. `memory/hindsight.md`).
```
