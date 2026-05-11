# Memory Index — ProspectionAgent

Index des notes de contexte. Une entrée = un fichier ciblé. Le contenu vit dans `.claude/context/`.

## Architecture
- [Pipeline nocturne](context/pipeline-nightly.md) — séquence orchestrator + APIs externes phase par phase
- [Modèle de données](context/data-model.md) — 5 tables Supabase, RLS, cycle de vie d'un prospect
- [Routes & UI](context/routes.md) — App Router, route groups (auth)/(dashboard), endpoints API, middleware

## Domaine
- [BEGES & réglementation](context/beges-glossary.md) — obligation L229-25, seuils, validité 4 ans, NAF prioritaires
- [Scoring composite](context/scoring-rules.md) — barème 0-100 et règles d'évolution

## Intégrations
- [APIs externes](context/external-apis.md) — Sirene OAuth2, ADEME, Recherche Entreprises, Pappers, Hunter.io, Resend
- [Prompts GPT-4o](context/prompts-guide.md) — système prompt, ordre des arguments, personae, JSON output, versionnage

## Operations
- [Crons Vercel](context/crons.md) — 22h + 7h30, Bearer CRON_SECRET, retry, test local
- [Sécurité](context/security.md) — RLS, service_role, secrets, Sentry PII, SSRF, Zod

---

## Conventions de lecture

- Chaque fiche est conçue pour être lue en < 2 minutes.
- Si une info est ici, ne pas dupliquer dans `CLAUDE.md` racine — pointer vers la fiche.
- Si une info est incertaine, la fiche dit "à vérifier dans le code" plutôt que d'inventer.
- Les logs utilisateur (`memory/primer.md`, `memory/hindsight.md`, `memory/session-context.md`, `memory/prompt-history.md`, `memory/MOC.md`) ne sont **pas** dupliqués ici — ce sont des journaux à part.
