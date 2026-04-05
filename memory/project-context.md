---
project: "Agent IA - Prospection Bilan Carbone"
domain: "saas"
type: "context"
created: "2026-04-05"
tags: [project/agent-ia---prospection-bilan-carbone, domain/saas, memory/context]
links:
  - "[[memory/MOC]]"
  - "[[memory/primer]]"
  - "[[memory/session-context]]"
  - "[[CLAUDE]]"
---

# Project Context — Agent IA - Prospection Bilan Carbone

> Fichier de contexte persistant. Mets-le à jour à chaque décision architecturale majeure.
> Ce fichier est lu automatiquement par GitHub Copilot pour contextualiser ses réponses.

---

## Description du projet
**Nom** : Agent IA - Prospection Bilan Carbone
**Domaine** : SaaS / B2B 📊
**Date de démarrage** : 2026-04-05

**Objectif initial** :
L'agent travaille en amont : il fait tout le travail de recherche, qualification et préparation. L'humain n'a plus qu'à décrocher son téléphone avec une liste de 15 appels/jour, chacun accompagné d'un pitch sur-mesure. -- Il s'agit d'un agent avec une APP en mode SaaS (Supabase, Vercel, git) - donc ...

---

## Informations à compléter (important !)
- [ ] Nombre d'utilisateurs / tenants attendus (mois 1, mois 12) ?
- [ ] Plans tarifaires (Free, Pro, Enterprise) ?
- [ ] Intégrations tierces prioritaires (Slack, CRM, webhooks) ?
- [ ] SLA requis par les clients enterprise ?

---

## Stack technique
- React / Next.js (dashboard frontend)
- Node.js ou Python FastAPI (backend)
- PostgreSQL + Redis (données + cache)
- Stripe Billing (abonnements et facturation)
- PostHog / Mixpanel (analytics produit)
- Datadog / Sentry (monitoring et erreurs)

## Architecture

| Couche | Choix | Justification |
|--------|-------|---------------|
| Frontend + API | Next.js 15 App Router (TS) | Server Components + API Routes serverless |
| Base de données | Supabase (PostgreSQL + RLS) | Auth intégrée, RLS multi-tenant, gratuit |
| Authentification | Supabase Auth (email + magic link) | Pas de gestion session custom |
| LLM | OpenAI GPT-4o | Choix utilisateur, bon rapport qualité/prix |
| Emails | Resend | Simple, 3000 emails/mois gratuit |
| Monitoring | Sentry + Vercel Analytics | Erreurs + perf |
| Déploiement | Vercel | Auto-deploy GitHub, cron intégré |
| CI/CD | GitHub Actions | lint + types + tests + build |
| Domaine | decarbonleads.strofe.fr (sous-domaine) | Gratuit, strofe.fr déjà sur Hostinger |

---

## Fonctionnalités principales
<!-- Liste les features planifiées avec leur état -->
- [ ] [Feature 1 — À définir]
- [ ] [Feature 2 — À définir]
- [ ] [Feature 3 — À définir]

---

## Décisions techniques clés

| Date | Décision | Raison | Alternatives écartées |
|------|----------|--------|----------------------|
| 2026-04-05 | Initialisation du projet | Setup initial | — |
| 2026-04-05 | Next.js 15 App Router | API Routes serverless + UI dans un seul repo | FastAPI séparé (trop de complexité) |
| 2026-04-05 | OpenAI GPT-4o pour le LLM | Choix utilisateur | Claude Sonnet (écarté sur préférence) |
| 2026-04-05 | Supabase comme DB + Auth | RLS natif, auth gratuite, SDK Next.js | PostgreSQL custom + NextAuth |
| 2026-04-05 | Sous-domaine decarbonleads.strofe.fr | Gratuit, domaine strofe.fr déjà possédé, plus descriptif | Nouveau domaine dédié (coût), app.strofe.fr (moins descriptif), chemin /path (impossible cross-host) |
| 2026-04-05 | Resend pour emails | Simple, 3000/mois gratuit | SendGrid (plus complexe), Nodemailer (pas de dashboard) |
| 2026-04-05 | Pas de Stripe en v1 | Produit à valider avant monétisation | Stripe dès le début (prématuré) |
| 2026-04-05 | ENUM PostgreSQL pour statuts | Sécurité des valeurs au niveau DB, lisibilité du schéma | CHECK constraints (moins expressives) |
| 2026-04-05 | user_id dénormalisé dans daily_list_items | RLS sans jointure coûteuse sur daily_lists | JOIN dans la policy RLS (perf dégradée sur gros volumes) |
| 2026-04-05 | JSONB pour settings, score_details, signaux, logs | Flexibilité d'évolution sans migration, indexable | Colonnes séparées (rigidité), EAV (anti-pattern) |

---

## Préoccupations domaine-spécifiques
- Onboarding utilisateur (time-to-value)
- Taux de churn et rétention
- Performance et scalabilité multi-tenant
- Isolation stricte des données entre tenants
- Intégrations tierces (Slack, Salesforce, Zapier)
- Feature flags pour déploiements progressifs

---

## Contraintes et limites connues
- [À documenter au fur et à mesure]

---

## Équipe
- **Développeur(s)** : [À renseigner]
- **Date cible de livraison** : [À définir]
- **Environnements** : dev / staging / production
