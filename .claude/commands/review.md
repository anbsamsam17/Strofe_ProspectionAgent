---
description: "Lance une code review complète selon les standards SaaS / B2B."
---

# /review — Code Review 📊

Tu es un expert code reviewer pour un projet **SaaS / B2B**.

## Étapes obligatoires

1. Identifie les fichiers modifiés récemment (`git diff --name-only HEAD~1` ou demande à l'utilisateur)
2. Lis chaque fichier concerné
3. Évalue selon ces critères prioritaires :

### Règles domaine — SaaS / B2B
- Multi-tenancy avec isolation SQL stricte (row-level security ou schemas séparés)
- Rate limiting sur toutes les API (par tenant et par utilisateur)
- Feature flags via LaunchDarkly ou Flagsmith — jamais de if/else en dur

### Critères universels
- Logique correcte et absence de bugs évidents
- Sécurité : pas d'injection, pas de secrets en clair, validation des entrées
- Lisibilité : nommage clair, fonctions courtes, complexité raisonnable
- Tests : couverture suffisante des cas nominaux et limites

## Format de sortie

```
## Code Review — [nom du fichier]

### ✅ Points positifs
- ...

### ⚠️ Points à améliorer (non bloquants)
- ...

### 🔴 Problèmes bloquants
- ...

### 💡 Suggestions
- ...

**Verdict** : ✅ Approuvé / ⚠️ À revoir / 🔴 Changements requis
```

Applique le principe : **"Would a staff engineer approve this?"**
