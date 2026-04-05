# CLAUDE.md — Agent IA - Prospection Bilan Carbone

> Ce fichier est lu automatiquement par **Claude Code** (CLI) et **Claude Desktop Projects**
> à chaque nouvelle conversation. Maintiens-le concis et à jour.

---

## Projet

**Agent IA - Prospection Bilan Carbone** — SaaS / B2B 📊
Démarré le 2026-04-05 | Stack : React / Next.js (dashboard frontend) | Node.js ou Python FastAPI (backend) | PostgreSQL + Redis (données + cache) | Stripe Billing (abonnements et facturation)

**Objectif** : L'agent travaille en amont : il fait tout le travail de recherche, qualification et préparation. L'humain n'a plus qu'à décrocher son téléphone avec une liste de 15 appels/jour, chacun accompagné d'un...

---

## Fichiers de contexte à lire en priorité

1. `memory/project-context.md` — Architecture et décisions techniques
2. `memory/primer.md` — Connaissance de fond et glossaire du domaine
3. `memory/session-context.md` — Objectif de la session courante
4. `memory/hindsight.md` — Leçons apprises et pièges à éviter
5. `memory/prompt-history.md` — Historique des tâches effectuées

---

## Règles de code — non négociables

- Multi-tenancy avec isolation SQL stricte (row-level security ou schemas séparés)
- Rate limiting sur toutes les API (par tenant et par utilisateur)
- Feature flags via LaunchDarkly ou Flagsmith — jamais de if/else en dur
- Logging centralisé structuré (JSON) avec correlation ID
- Tests de charge (k6, Locust) avant chaque release majeure

---

## Préoccupations métier — toujours garder en tête

- Onboarding utilisateur (time-to-value)
- Taux de churn et rétention
- Performance et scalabilité multi-tenant
- Isolation stricte des données entre tenants
- Intégrations tierces (Slack, Salesforce, Zapier)
- Feature flags pour déploiements progressifs

---

## Ce que tu NE dois PAS faire

- Ne pas modifier l'architecture sans documenter la décision dans `memory/project-context.md`
- Ne pas introduire de nouvelles dépendances sans évaluer la sécurité et la maintenance
- Ne pas supposer le contexte : si une information manque, demande-la
- Ne pas générer de code fonctionnel sans tests ou instructions de validation
- Ne jamais marquer une tâche comme terminée sans avoir prouvé qu'elle fonctionne

---

## Verification Before Done

Avant de considérer une tâche terminée, tu dois :

1. Vérifier que le code produit fait ce qui était demandé (diff, logs, tests)
2. Te poser la question : **"Un senior dev validerait-il ce code en review ?"**
3. Démontrer la correction : run tests, affiche les logs, prouve le bon comportement
4. Si un bug est reporté : trouve la cause racine et fixe-la — ne contourne pas

---

## Self-Improvement Loop

Après TOUTE correction de l'utilisateur sur ton travail :

1. **Identifie le pattern** : pourquoi cette erreur s'est-elle produite ?
2. **Écris une règle** dans `memory/hindsight.md` pour éviter de la répéter :
   ```
   ## [Date] — [Titre de la leçon]
   **Erreur commise** : ...
   **Règle à retenir** : ...
   **Comment l'éviter** : ...
   ```
3. **Relis `memory/hindsight.md`** au début de chaque session pour réactiver les leçons passées

---

## Workflow attendu

1. Lis les fichiers de contexte listés ci-dessus (dont `memory/hindsight.md`)
2. Exécute la tâche demandée
3. **Vérifie** que la tâche fonctionne avant de la déclarer terminée (Verification Before Done)
4. Après la tâche, mets à jour :
   - `memory/session-context.md` (bilan de session)
   - `memory/prompt-history.md` (nouvelle entrée)
   - `memory/project-context.md` si une décision architecturale a changé
   - `memory/hindsight.md` si tu as appris quelque chose d'important ou reçu une correction

---

## Commandes utiles du projet

```bash
# Charger le contexte complet avant une session Claude CLI
bash scripts/memory.sh

# Équivalent PowerShell (Windows)
powershell scripts/memory.ps1
```
