# Code Style — SaaS / B2B 📊

> Règles de style et conventions appliquées automatiquement sur ce projet.
> Ce fichier est lu par Claude Code à chaque session.

---

## Stack technique

- React / Next.js (dashboard frontend)
- Node.js ou Python FastAPI (backend)
- PostgreSQL + Redis (données + cache)
- Stripe Billing (abonnements et facturation)
- PostHog / Mixpanel (analytics produit)
- Datadog / Sentry (monitoring et erreurs)

## Règles obligatoires — SaaS / B2B

- Multi-tenancy avec isolation SQL stricte (row-level security ou schemas séparés)
- Rate limiting sur toutes les API (par tenant et par utilisateur)
- Feature flags via LaunchDarkly ou Flagsmith — jamais de if/else en dur
- Logging centralisé structuré (JSON) avec correlation ID
- Tests de charge (k6, Locust) avant chaque release majeure

## Conventions universelles

- **Nommage** : snake_case pour Python, camelCase pour JS/TS, PascalCase pour les classes
- **Fonctions** : une fonction = une responsabilité, < 30 lignes idéalement
- **Commentaires** : explique le *pourquoi*, pas le *quoi* — le code dit déjà le quoi
- **Imports** : triés (stdlib → third-party → local), pas d'imports non utilisés
- **Erreurs** : toujours explicites, jamais silencieuses (`except: pass` interdit)

## Ce qui est interdit

- Code mort commenté (supprime-le, git garde l'historique)
- Magic numbers sans constante nommée
- Secrets ou credentials en dur
- TODO sans ticket associé
