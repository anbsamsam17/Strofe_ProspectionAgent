# Prompts LLM — Agent IA Prospection Bilan Carbone

> Règles pour tout ce qui touche aux appels LLM dans ce projet.

---

## Où vivent les prompts

- Les prompts sont dans `lib/agent/gemini-scoring.ts` (constantes `SYSTEM_PROMPT` et `SECTEUR_SYSTEM_PROMPT` au niveau module).
- Toute évolution d'un prompt système se fait dans ce fichier — pas de prompt inline dans un autre module, pas de prompt construit dynamiquement depuis du config externe non versionné.
- Le module héberge deux usages distincts :
  - **Scoring commercial** (`scoreLeadAvecGemini` / `scoreLeadsBatchGemini`) : note d'intérêt 0-100 + 3 à 5 raisons d'appel spécifiques au prospect.
  - **Catégorisation secteur** (`categoriserSecteurAvecGemini`) : complète `prospects.secteur_libelle` + une catégorie figée quand le libellé est vide.
- Les variantes d'angle par persona (RSE / DAF / DRH / DG) se gèrent dans le message `user`, pas dans le système.

## Modèle

- Modèle **figé sur `gemini-2.0-flash`** (constante `GEMINI_MODEL` dans `gemini-scoring.ts`).
- Rapide, économique, suffisant pour ce use case (scoring + catégorisation, pas de génération longue).
- **Pas de bascule sur un autre fournisseur** (OpenAI, etc.) sans décision explicite : le module est conçu autour du structured output natif Gemini (`responseSchema` + `responseMimeType: 'application/json'`).
- Tout bump de modèle (nouveau snapshot Gemini) doit être :
  1. Explicite : update `GEMINI_MODEL` + entry datée dans `memory/hindsight.md`.
  2. Validé : dry-run sur 3 prospects test, comparaison qualitative des outputs.
  3. Traçable : la version du modèle reste lisible dans le code (constante) et dans les logs structurés du module.

## Persona système (figé)

Expert en prospection B2B pour des consultants Strofe spécialisés en bilan carbone et décarbonation en France. Son rôle n'est **pas** d'écrire un pitch, mais d'**évaluer l'intérêt commercial** à proposer un BEGES à une entreprise donnée et de fournir les **raisons spécifiques** à cette entreprise. Ton : professionnel, orienté bénéfice, factuel. Pas moralisateur, pas alarmiste.

## Ordre obligatoire des raisons

Les raisons produites sont des arguments d'appel. L'ordre des leviers est **testé en field** et non négociable :

1. **Gains financiers concrets** — ROI sur consommations identifiées, subventions ADEME, prêts BPI bonifiés, accès aux appels d'offres publics avec critères RSE.
2. **Image de marque** — signal de gouvernance, qualification fournisseur des grands comptes, différenciation concurrentielle.
3. **Contrainte légale** — en appui seulement. Article L. 229-25, amende administrative jusqu'à **50 000 €** par BEGES manquant (montant porté de 10 000 € par la loi Industrie verte de 2023, **100 000 €** en cas de récidive).

**Ne JAMAIS ouvrir par la contrainte légale.** Approche froide, rebute le DAF, casse le rendez-vous. C'est l'erreur classique des consultants débutants en bilan carbone.

## Adaptation par persona cible

L'angle des raisons s'adapte au persona visé :
- **RSE / Direction Développement Durable** : impact climat, mesure des scopes 1/2/3, méthode bilan carbone ABC.
- **DAF / Direction Financière** : ROI, économies opérationnelles, subventions, accès financements verts.
- **DRH** : marque employeur, attractivité jeunes diplômés, engagement collaborateurs.
- **DG / Président** : risque légal, accès aux marchés, vision long terme.

L'ordre des 3 piliers (gains / image / légal) reste le même ; seule l'emphase relative bouge.

## Format de sortie

- Toujours **JSON structuré natif Gemini** : `generationConfig.responseMimeType = 'application/json'` + `responseSchema` (`ObjectSchema` typé via `SchemaType`).
- Le structured output natif ne suffit pas : **re-validation Zod systématique** du JSON parsé avant utilisation (`geminiResponseSchema`, `secteurResponseSchema`). Pas de `JSON.parse()` exploité sans passage par le schema Zod.
- Scoring : `interet_score` entier 0-100 + `raisons` (tableau de 3 à 5 chaînes). Mismatch = échec → fallback.
- Catégorisation : `secteur_libelle` + `secteur_categorie` (enum fermé : industrie, transport, energie, construction, agriculture, services, commerce, eau_dechets, autre) + `confidence` (high/medium/low).

## PII

- **Pas de PII dans le prompt** — ni système, ni utilisateur.
- L'input est volontairement restreint au type `GeminiProspectInput` (`Pick` sur `Prospect`) qui **exclut** `contact_email`, `contact_telephone`, `contact_nom`, `contact_prenom`. Ne jamais élargir ce type aux champs de contact.
- Seules les données entreprise (raison sociale, secteur, taille, état BEGES, signaux, ville) entrent dans le message `user`.

## Robustesse

- Timeout par appel : `GEMINI_TIMEOUT_MS = 15_000` (scoring) / `SECTEUR_TIMEOUT_MS = 8_000` (catégorisation), via `withTimeout` (Promise.race).
- Retry : `GEMINI_MAX_RETRIES = 1` sur erreur retriable (429 / 5xx / timeout), délai `GEMINI_RETRY_DELAY_MS = 500`.
- Batch parallèle limité : `GEMINI_PARALLEL_GROUP_SIZE = 5`, `GEMINI_BATCH_DELAY_MS = 200` entre groupes.
- **Distinction échec transitoire / définitif** (clé du module) : sur échec, le fallback marque `transient_failure`.
  - Transitoire (timeout / 429 / 5xx / réseau) → le caller laisse `gemini_generated_at` NULL pour re-tenter le prospect au prochain run (pas de verrouillage à `interet_score: 0`).
  - Définitif (clé absente, JSON/Zod KO, erreur non-retriable) → résultat stable, persistable tel quel.
- Aucun throw côté batch : chaque prospect a son propre fallback. Un échec n'interrompt jamais les autres.
- Catégorisation : retourne `null` (jamais throw) dans tous les cas dégradés ; le caller ne doit pas écraser `secteur_libelle` existant. Cache LRU (TTL 1h, capacité 1000) + throttle pour préserver le quota.

## Mitigation prompt-injection

- Toute donnée externe (raison sociale, signaux scrapés) passe par `sanitizeForPrompt` : suppression des caractères de contrôle, échappement `<`/`>`, troncature.
- Injectée sous balise `<données_entreprise>…</données_entreprise>` avec instruction explicite d'ignorer toute instruction qu'elle contiendrait.
- Heuristiques `INJECTION_PATTERNS` (« ignore previous instructions », « you are now », `system:`, `<system>`, etc.) — log `warn` non bloquant si match.

## Versionnage

- Tout changement majeur d'un `SYSTEM_PROMPT` :
  1. Entry datée dans `memory/hindsight.md` (raison du changement, version avant/après).
  2. Dry-run sur 3 prospects test (siren stables) pour comparer outputs.
  3. Si régression qualitative : revert.
- Les diffs sur les prompts système sont reviewés au même titre que du code.
