---
project: "Agent IA - Prospection Bilan Carbone"
domain: "saas"
type: "primer"
created: "2026-04-05"
tags: [project/agent-ia---prospection-bilan-carbone, domain/saas, memory/primer]
links:
  - "[[memory/MOC]]"
  - "[[CLAUDE]]"
  - "[[memory/project-context]]"
---

# Primer — Agent IA - Prospection Bilan Carbone

> Connaissance de fond sur le domaine **SaaS / B2B**.
> Ce fichier est passé en contexte au début de chaque session importante.
> Mets-le à jour quand tu découvres de nouveaux concepts clés.

---

## Domaine : SaaS / B2B 📊

Expert développeur saas b2b spécialisé dans la scalabilité, la rétention utilisateur et l'expérience produit.

---

## Stack technique — détails et choix

- **React** — / Next.js (dashboard frontend)
- **Node.js** — ou Python FastAPI (backend)
- **PostgreSQL** — + Redis (données + cache)
- **Stripe** — Billing (abonnements et facturation)
- **PostHog** — / Mixpanel (analytics produit)
- **Datadog** — / Sentry (monitoring et erreurs)

---

## Concepts clés du domaine

<!-- Documente les termes métier et techniques importants pour CE projet -->

| Terme | Définition | Notes |
|-------|------------ |-------|
| [Terme 1] | [Définition] | |
| [Terme 2] | [Définition] | |

---

## Préoccupations et risques du domaine

- Onboarding utilisateur (time-to-value)
- Taux de churn et rétention
- Performance et scalabilité multi-tenant
- Isolation stricte des données entre tenants
- Intégrations tierces (Slack, Salesforce, Zapier)
- Feature flags pour déploiements progressifs

---

## Règles métier fondamentales

<!-- Les règles qui ne changent jamais, quel que soit le sprint -->

- [ ] [Règle métier 1 — À définir]
- [ ] [Règle métier 2 — À définir]

---

## Ressources de référence

<!-- Docs officielles, specs, RFCs, APIs tierces -->

| Ressource | URL | Pourquoi utile |
|-----------|-----|----------------|
| [Doc officielle] | [URL] | |
| [API de paiement] | [URL] | |

---

## Anti-patterns connus dans ce domaine

<!-- Ce qui NE fonctionne PAS dans ce type de projet — à éviter absolument -->

- [Anti-pattern 1 — À documenter]

---

## Intégrations tierces

<!-- Services externes dont dépend ce projet -->

| Service | Rôle | Credentials |
|---------|------|-------------|
| [Service 1] | [Rôle] | `.env` → `SERVICE_API_KEY` |
