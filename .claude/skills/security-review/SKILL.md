---
name: security-review
description: "Deep security audit workflow for SaaS / B2B projects. Use proactively when the user mentions: security, vulnerability, audit, pentest, compliance, authentication, authorization, sensitive data, or when reviewing code that handles user input, payments, or medical data."
---

# Skill : Security Review — SaaS / B2B 📊

## Déclencheur automatique

Activé quand l'utilisateur mentionne : sécurité, vulnérabilité, audit, pentest, conformité, authentification, autorisation, données sensibles, RGPD, PCI-DSS, HIPAA.

## Étape 1 : Contexte

Lis `memory/project-context.md` pour identifier :
- Architecture et points d'entrée
- Stack technique et dépendances
- Données sensibles manipulées

## Étape 2 : Audit domaine-spécifique

### Préoccupations prioritaires — SaaS / B2B
- Onboarding utilisateur (time-to-value)
- Taux de churn et rétention
- Performance et scalabilité multi-tenant
- Isolation stricte des données entre tenants
- Intégrations tierces (Slack, Salesforce, Zapier)
- Feature flags pour déploiements progressifs

## Étape 3 : OWASP Top 10

Vérifie systématiquement chaque catégorie sur les fichiers concernés.

## Étape 4 : Rapport

Classe les vulnérabilités : 🔴 Critique → fix immédiat / 🟡 Moyen → sprint suivant / 🟢 Faible → backlog

## Étape 5 : Suivi

Documente les findings dans `memory/hindsight.md`.
