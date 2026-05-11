# Prompts LLM — Agent IA Prospection Bilan Carbone

> Règles pour tout ce qui touche aux appels OpenAI dans ce projet.

---

## Où vivent les prompts

- Les prompts GPT-4o sont dans `lib/agent/pitch-gen.ts` (constante `SYSTEM_PROMPT` au niveau module).
- Toute évolution du prompt système se fait dans ce fichier — pas de prompt inline dans un autre module, pas de prompt construit dynamiquement depuis du config externe non versionné.
- Les variantes par persona (RSE / DAF / DRH / DG) sont gérées dans le message `user`, pas dans le système.

## Modèle

- Modèle **figé sur `gpt-4o`** (constante `GPT_MODEL` dans `pitch-gen.ts`).
- **Pas de `gpt-3.5-turbo`** (qualité insuffisante sur pitch B2B).
- **Pas de `gpt-4`** (déprécié dans notre usage).
- Tout bump de modèle (ex. vers un nouveau snapshot) doit être :
  1. Explicite : update `GPT_MODEL` + entry datée dans `memory/hindsight.md`.
  2. Validé : dry-run sur 3 prospects test, comparaison qualitative des outputs.
  3. Loggué : version du modèle écrite dans `agent_runs` pour traçabilité.

## Persona système (figé)

Expert en prospection B2B pour consultants en bilan carbone et décarbonation en France. Ton : professionnel, orienté bénéfice, factuel. Pas moralisateur, pas alarmiste.

## Ordre obligatoire du pitch

Cet ordre est **testé en field** et non négociable :

1. **Gains financiers concrets** — ROI 10-30% sur consommations identifiées, subventions ADEME jusqu'à 70%, prêts BPI bonifiés, accès aux appels d'offres publics avec critères RSE.
2. **Image de marque** — signal de gouvernance, qualification fournisseur des grands comptes, différenciation concurrentielle.
3. **Contrainte légale** — en appui seulement (réponse aux objections). Article L229-25, amende jusqu'à 10 000 € par BEGES manquant.

**Ne JAMAIS commencer par la contrainte légale.** Approche froide, rebute le DAF, casse le rendez-vous. C'est l'erreur classique des consultants débutants en bilan carbone.

## Adaptation par persona cible

Le champ `target_persona` du prospect influence l'angle :
- **RSE / Direction Développement Durable** : impact climat, mesure des scopes 1/2/3, méthode bilan carbone ABC.
- **DAF / Direction Financière** : ROI, économies opérationnelles, subventions, accès financements verts.
- **DRH** : marque employeur, attractivité jeunes diplômés, engagement collaborateurs.
- **DG / Président** : risque légal, accès aux marchés, vision long terme.

L'ordre des 3 piliers (gains / image / légal) reste le même ; seule l'emphase relative bouge.

## Format de sortie

- Toujours **JSON structuré** côté SDK : `response_format: { type: 'json_object' }`.
- Validation Zod du JSON parsé avant insertion en DB. Pas de `JSON.parse()` brut sans schema.
- Le schema de sortie (`GeneratedPitch` dans `lib/types.ts`) définit les champs attendus. Mismatch = échec du pitch, on retry une fois.

## PII

- **Pas de PII dans le system prompt** (figé, ne contient aucune donnée prospect).
- Les données prospect (raison sociale, dirigeant, secteur, taille) vont dans le message `user`.
- Pas d'email ni téléphone dans le prompt — non nécessaire à la génération.

## Robustesse

- Timeout 30s par appel OpenAI (`pitch-gen.ts`).
- `maxRetries: 2` au niveau SDK.
- Batch parallèle limité (`PARALLEL_GROUP_SIZE = 5`, `BATCH_DELAY_MS = 150`) pour respecter les rate limits gpt-4o (500 RPM).
- Sur échec définitif d'un pitch : prospect marqué `pitch_status = 'failed'`, run continue (les 14 autres pitchs ne doivent pas casser).

## Versionnage

- Tout changement majeur de `SYSTEM_PROMPT` :
  1. Entry datée dans `memory/hindsight.md` (raison du changement, version avant/après).
  2. Dry-run sur 3 prospects test (siren stables) pour comparer outputs.
  3. Si régression qualitative : revert.
- Les diffs sur le prompt système sont reviewés au même titre que du code.
