---
name: deploy
description: "Structured deployment checklist workflow for SaaS / B2B projects. Use proactively when the user mentions: deploy, release, mise en production, push to prod, livraison, CI/CD, pipeline."
---

# Skill : Deploy — SaaS / B2B 📊

## Déclencheur automatique

Activé quand l'utilisateur mentionne : déployer, release, mise en production, push to prod, livraison, CI/CD.

## Pré-déploiement (obligatoire)

1. Vérifie que tous les tests passent
2. Vérifie les variables d'environnement de production
3. Valide les migrations de base de données
4. Confirme le rollback plan

## Déploiement

1. Déploiement staging → smoke tests → production
2. Monitoring actif pendant 10 minutes post-déploiement

## Post-déploiement

1. Vérification des endpoints critiques
2. Mise à jour de `memory/session-context.md`
3. Documentation dans `memory/hindsight.md` si incident

## Checklist domaine — SaaS / B2B

- [ ] Onboarding utilisateur
- [ ] Taux de churn et rétention
- [ ] Performance et scalabilité multi-tenant
- [ ] Isolation stricte des données entre tenants
