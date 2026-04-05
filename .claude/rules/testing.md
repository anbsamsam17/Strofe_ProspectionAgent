# Testing Conventions — SaaS / B2B 📊

> Standards de test pour ce projet.
> Claude Code applique ces conventions dans tous les tests générés.

---

## Philosophie

- **Teste le comportement**, pas l'implémentation
- **AAA pattern** : Arrange → Act → Assert
- Un test = un seul concept vérifié
- Les tests doivent être lisibles sans commenter

## Structure des tests

```
tests/
├── unit/          # Tests unitaires — rapides, isolés
├── integration/   # Tests d'intégration — avec vraie DB/API
└── e2e/           # Tests end-to-end — scénarios utilisateur
```

## Règles domaine — SaaS / B2B

- Onboarding utilisateur (time-to-value)
- Taux de churn et rétention
- Performance et scalabilité multi-tenant

## Couverture minimale

- Fonctions critiques métier : **100%**
- API endpoints : **tous les cas d'erreur testés**
- Fonctions utilitaires : **> 80%**

## Ce qui doit toujours être testé

- Cas nominal (happy path)
- Cas limite (valeurs vides, nulles, max)
- Cas d'erreur (input invalide, service down)
- Sécurité si applicable (injection, auth)

## Avant de marquer une tâche terminée

Vérifie : **"Would a staff engineer approve this test suite?"**
