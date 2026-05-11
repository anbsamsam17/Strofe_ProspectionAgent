# `.claude/` — Configuration Claude Code de l'Agent IA Prospection

Ce dossier contient toute la configuration Claude Code spécifique au projet. Tout est versionné Git pour que chaque dev ait le même comportement de l'assistant.

## Structure

```
.claude/
├── README.md                    # Ce fichier
├── settings.json                # Permissions, hooks, env (chargé au démarrage)
├── agents/                      # Sous-agents disponibles via le tool Task
│   ├── code-reviewer.md
│   ├── database-administrator.md
│   ├── debugger.md
│   ├── devops-engineer.md
│   ├── fullstack-developer.md
│   ├── orchestrator.md
│   ├── performance-engineer.md
│   ├── product-manager.md
│   ├── qa-expert.md
│   └── security-auditor.md
├── commands/                    # Slash commands (ex. /deploy, /review)
│   ├── deploy.md
│   ├── fix-issue.md
│   ├── review.md
│   └── security-audit.md
├── rules/                       # Règles toujours applicables au code généré
│   ├── api-design.md            # Pattern routes Next.js + Zod + RLS
│   ├── code-style.md            # TS strict, naming, imports, Tailwind v4
│   ├── llm-prompts.md           # Règles pour les prompts GPT-4o (pitch-gen)
│   ├── security.md              # RLS, service_role, CRON_SECRET, SSRF, PII
│   └── testing.md               # Vitest, mocks APIs, coverage cibles
└── skills/                      # Workflows activés par mots-clés / contexte
    ├── agent-debugging/         # Debug pipeline nocturne
    ├── deploy/                  # Checklist deploy Vercel
    ├── migration-helper/        # Workflow nouvelle migration Supabase
    └── security-review/         # Audit RLS, secrets, type bypass
```

## Comment Claude Code utilise ce dossier

- **`settings.json`** : chargé au démarrage de la session. Définit permissions outils, hooks (pré/post commit, etc.), variables d'env.
- **`agents/*.md`** : sous-agents disponibles via le tool Task. Claude les appelle quand le besoin matche leur description (ex. `security-auditor` pour un audit profond).
- **`commands/*.md`** : slash commands. L'utilisateur tape `/deploy` ou `/review` pour les déclencher.
- **`rules/*.md`** : règles consultées par Claude quand il génère du code. Lecture ciblée selon le fichier modifié (ex. modifier une route API → `rules/api-design.md` + `rules/security.md`).
- **`skills/<name>/SKILL.md`** : workflows activés par contexte. La frontmatter `description` indique les mots-clés déclencheurs ; le corps liste les étapes à suivre.
- **`memory/`** (à la racine du repo, hors `.claude/`) : `MOC.md`, `project-context.md`, `session-context.md`, `hindsight.md`, `primer.md`, `prompt-history.md`. Index lu à chaque session pour le contexte projet.
- **`CLAUDE.md`** (à la racine) : instructions principales chargées en système au démarrage.

## Convention

- **Tout en français** : ce projet est francophone (consultants français, BEGES, ADEME, Sirene). La cohérence linguistique évite les frictions.
- **Ajouter une règle** → `rules/<sujet>.md`. Doit rester < 120 lignes pour être actionnable.
- **Ajouter un workflow déclenché par contexte** → `skills/<name>/SKILL.md` avec frontmatter `name` + `description`.
- **Ajouter un slash command explicite** → `commands/<name>.md`.

## Maintenance

Quand mettre à jour ce dossier :

| Évènement | Fichier à toucher |
|---|---|
| Nouvelle table Supabase | `memory/project-context.md` (data model) |
| Nouveau cron Vercel | `memory/session-context.md`, `skills/deploy/SKILL.md` |
| Changement majeur du prompt GPT-4o | `rules/llm-prompts.md` + entry dans `memory/hindsight.md` |
| Nouvelle API externe intégrée | whitelist dans `rules/security.md` (SSRF) |
| Nouvelle convention de style | `rules/code-style.md` |
| Nouveau pattern de test | `rules/testing.md` |
