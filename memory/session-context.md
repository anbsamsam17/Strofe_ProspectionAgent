---
project: "Agent IA - Prospection Bilan Carbone"
domain: "saas"
type: "session"
created: "2026-04-05"
tags: [project/agent-ia---prospection-bilan-carbone, domain/saas, memory/session]
links:
  - "[[memory/MOC]]"
  - "[[memory/project-context]]"
  - "[[memory/hindsight]]"
---

# Session Context — Contexte de Session Courante

> Efface et remets à zéro à chaque nouvelle session de travail.

---

## Session du : 2026-04-05 (mise a jour — Fix Tailwind v4 + Redesign Landing & Auth)

## Objectif de cette session
Corriger la configuration Tailwind CSS v4 (app inaccessible — raw text sans styles) et refondre la landing page + les pages auth pour un rendu SaaS moderne de niveau production.

---

## Décisions prises cette session

- Stack : Next.js 15 App Router + Supabase + Vercel (confirmé)
- Pas de paiement Stripe pour la v1
- Email via Resend (notifications "liste prête")
- Monitoring via Sentry (erreurs) + Vercel Analytics (perf)
- CI/CD via GitHub Actions → auto-deploy sur Vercel
- Auth : Supabase Auth (email + magic link)
- Cron nocturne : Vercel Cron Jobs (22h00 chaque soir)
- LLM : Claude API claude-sonnet-4-6
- Instrumentation Sentry : via instrumentation.ts (Next.js 15 register() standard)
- Sentry server config : instrumentationHook: true + profilesSampleRate: 0.05 + skipOpenTelemetrySetup: true
- Edge runtime Sentry : config séparée sentry.edge.config.ts (sans profiling natif)
- CI : jobs lint / typecheck / test en parallele, build apres avec cache .next/cache
- Deploy preview : gate tests avant deploy Vercel, commentaire PR avec URL

## Plan validé (10 étapes)

1. Infrastructure (Supabase + Vercel + GitHub + domaine)
2. Init Next.js + config complète (env vars, Sentry, tailwind)
3. Schema DB + migrations Supabase
4. Auth (login, signup, middleware, callback)
5. Agent core (sourcing Sirene + ADEME, scoring, pitch Claude)
6. API Routes (cron, daily-list, feedback, prospects)
7. Dashboard UI (liste du jour, pipeline, dashboard)
8. Emails (Resend — notification matin)
9. Monitoring (Sentry + Vercel Analytics)
10. CI/CD (GitHub Actions → Vercel)

---

## Tâches planifiées
- [x] Lire les fichiers de contexte
- [x] Définir le plan complet déploiement inclus
- [ ] Commencer l'implémentation étape 1
- [ ] Infrastructure (Supabase + Vercel + GitHub + domaine)
- [ ] Init Next.js + config complète
- [x] Etape 3 — Schema DB + migrations Supabase
- [x] DevOps — ci.yml amélioré (jobs parallèles, cache .next, vars SENTRY fictives)
- [x] DevOps — deploy-preview.yml créé (gate tests + Vercel CLI + commentaire PR)
- [x] DevOps — sentry.server.config.ts amélioré (instrumentationHook, profiling, skipOTEL)
- [x] DevOps — instrumentation.ts créé (register() + onRequestError)
- [x] DevOps — sentry.edge.config.ts créé (Edge runtime)
- [x] DevOps — app/global-error.tsx créé (error boundary global + Sentry captureException)
- [x] Etape 4 — Auth layer complet (login, signup, layout, callback, confirm, composants)
- [x] Etape 5 — Agent core (sourcing Sirene + ADEME, scoring, pitch GPT-4o, orchestrateur)
- [x] Etape 6 — API Routes (7 routes complètes avec auth, validation Zod, erreurs standardisées)
- [x] Etape 8 — Système emails (Resend + React Email — templates daily-ready + welcome)
- [x] Etape 7 — Dashboard UI complet (layout, sidebar, 5 pages, composants)

---

## Fichiers créés / modifiés cette session (Étape 7)
- app/(dashboard)/layout.tsx (NOUVEAU) — Server Component, sidebar + header, session Supabase
- app/(dashboard)/dashboard/page.tsx (NOUVEAU) — métriques du jour, run agent, 3 prochains appels
- app/(dashboard)/daily-list/page.tsx (NOUVEAU) — liste 15 appels, statut, barre progression
- app/(dashboard)/prospects/page.tsx (NOUVEAU) — table paginée, filtres, tri par colonne
- app/(dashboard)/pipeline/page.tsx (NOUVEAU) — Kanban 5 colonnes
- app/(dashboard)/settings/page.tsx (NOUVEAU) — formulaire de configuration agent
- components/layout/sidebar.tsx (NOUVEAU) — logo, nav icônes SVG inline, bottom nav mobile
- components/layout/dashboard-header.tsx (NOUVEAU) — badge statut agent, bouton lancer agent
- components/dashboard/generate-list-button.tsx (NOUVEAU) — bouton Générer/Régénérer
- components/daily-list/daily-list-client.tsx (NOUVEAU) — wrapper Client Component pour les cards
- components/daily-list/prospect-card.tsx (NOUVEAU) — carte prospect complète avec formulaire feedback
- components/prospects/prospects-filters.tsx (NOUVEAU) — filtres statut/secteur/score avec useRouter
- components/pipeline/pipeline-client.tsx (NOUVEAU) — Kanban Client Component + modale détail
- components/settings/settings-form.tsx (NOUVEAU) — formulaire TailwindCSS pur
- app/api/profile/settings/route.ts (NOUVEAU) — PATCH settings JSONB avec merge

---

## Fichiers modifiés cette session
- lib/supabase/database.types.ts — interface Database → type Database (requis par Supabase v2.101 pour Omit<Database, '__InternalSupabase'>)
- lib/supabase/server.ts — ajout export type SupabaseServerClient = ReturnType<typeof createServerClient<Database>>
- lib/agent/orchestrator.ts — use SupabaseServerClient, as unknown as Prospect[], as unknown as Json, cast upsert/insert payloads
- app/(dashboard)/pipeline/page.tsx — as unknown as Prospect[]
- app/(dashboard)/prospects/page.tsx — as unknown as Prospect[]
- app/api/daily-list/route.ts — as unknown as DailyListItem[]
- app/api/notifications/daily/route.ts — as unknown as {...} pour le join profiles
- next.config.ts — typedRoutes sorti de experimental (déplacé au top-level)
- package.json — @supabase/ssr upgradé de 0.6.1 à 0.10.0 (compatible @supabase/supabase-js@2.101.1)

## Session du : 2026-04-06 — Audit de debug complet du pipeline agent

## Objectif de cette session
Audit complet du pipeline agent : connectivité APIs, data flow, type safety, error scenarios, edge cases, API routes.

## Taches effectuees
- [x] Lecture de tous les fichiers du pipeline (orchestrator, sourcing, scoring, pitch-gen, 7 API routes, types, migrations SQL)
- [x] Rapport d'audit produit : 9 bugs confirmés + 8 risques identifiés + 13 recommandations

## Bugs confirmés identifiés
1. ADEME resource_id placeholder invalide (sourcing.ts:20) — fausse tout le scoring BEGES
2. CHAR(9) vs VARCHAR(9) pour siren — padding espaces casse la déduplication (migration 001)
3. pitchs.length != prospects.length non détecté — daily list avec pitchs vides (orchestrator.ts:441)
4. Double calcul new Date() dans daily-list/route.ts — incohérence possible à minuit
5. createAdminClient lit cookies inutilement — dépendance contexte Next.js (server.ts:37)
6. Regex UUID trop permissive dans feedback/route.ts:88
7. notification_email + target_postal_codes non mergés dans settings/route.ts:86-99
8. Fire-and-forget Vercel incompatible avec serverless (daily-list/route.ts:126) — Promise tuée après réponse
9. Aucun timeout OpenAI configuré — risque timeout Vercel 300s dépassé

## Etat en fin de session
Audit produit — aucun code modifié. Les correctifs sont documentés avec priorité P0/P1/P2.

---

## Session du : 2026-04-06 — Audit Performance Pipeline Agent Nocturne

## Objectif de cette session
Audit complet des performances du pipeline agent : timing budget, bottlenecks, optimisations, frontend, DB, scalabilité.

## Résultats de l'audit

### Timing estimé (pipeline nominal, 1 user)
- Sourcing Sirene : ~3.7s (2 pages + delay 2.1s)
- Enrichissement ADEME : ~8s (20 batchs de 10)
- Scoring + upsert : ~600ms (4 batchs de 50)
- Sélection top 15 : ~30ms (index composite)
- Pitchs GPT-4o : ~60s (15 × 4s séquentiel — goulot principal)
- Daily list création : ~180ms
- TOTAL ESTIMÉ : 62-93s / budget 300s — marge confortable mais vulnérable

### Top 3 bottlenecks
1. Pitchs GPT-4o séquentiels : 55-75% du temps total
2. Enrichissement ADEME : 8-15% du temps total
3. 9 updateRunInDB séquentiels : frais généraux ~360ms

### Top 5 optimisations recommandées
1. Paralléliser pitchs GPT-4o en groupes de 5 → -42 à -55s (Impact Elevé / Effort Faible)
2. Réduire BATCH_DELAY_MS de 500ms à 150ms → -5s (Impact Moyen / Effort Minimal)
3. Augmenter ADEME_BATCH_SIZE de 10 à 20 → -4 à -6s (Impact Moyen / Effort Faible)
4. updateRunInDB intermédiaires en fire-and-forget → -240ms (Impact Faible / Effort Faible)
5. Cache Redis Upstash pour ADEME par SIREN (TTL 24h) → élimine la phase ADEME à long terme

### Scalabilité
- Risque critique : cron multi-user partage le même token INSEE → 10 users = 300 req/min vs limite 30 req/min
- Solution : migrer vers Inngest/Trigger.dev pour isoler chaque run dans sa propre invocation serverless
- Seuil sûr sans queue : 2-3 users simultanés

## Session du : 2026-04-06 — Fix pipeline + premiere generation de prospects

## Objectif de cette session
Corriger les blocages du pipeline agent (middleware, auth INSEE, sourcing) et generer la premiere liste de prospects.

## Bugs corriges
1. **Middleware bloquait /api/* routes** — Les endpoints cron avec Bearer token etaient rediriges vers /login. Fix : ajout `isApiRoute` bypass.
2. **INSEE OAuth2 mort** — Le systeme d'authentification OAuth2 (client_id/secret → Bearer) a ete supprime par l'INSEE en sept. 2025. Remplace par API Key simple (`X-INSEE-Api-Key-Integration`). URL changee : `api.insee.fr/api-sirene/3.11/siret`.
3. **Fallback sourcing non declenche** — `sourcerEntreprises()` retournait `[]` sur HTTP 401 sans throw. L'orchestrateur ne basculait pas sur le fallback. Fix : fallback sur `etablissements.length === 0`.
4. **Format NAF dans fallback** — L'API Recherche Entreprises veut le format AVEC point (`49.41A`). Notre code enlevait le point.

## Fichiers modifies
- middleware.ts — bypass auth redirect pour /api/* routes
- lib/agent/sourcing.ts — supprime OAuth2, ajoute API Key, ajoute fallback Recherche Entreprises
- lib/agent/orchestrator.ts — import fallback, trigger sur 0 resultats
- .env.local — INSEE_CLIENT_ID/SECRET → INSEE_API_KEY

## Resultats du pipeline
- 96 prospects sources (via fallback Recherche Entreprises)
- 96 prospects qualifies (score >= 20)
- 15 appels/jour generes avec pitchs personnalises GPT-4o
- Top prospects : Dassault Aviation (78), ArianeGroup (78), Airbus Atlantic (78)
- Daily list statut "ready" pour le 2026-04-06

## Agents d'audit lances en parallele
- code-reviewer (Opus) — en cours
- debugger (Sonnet) — en cours
- performance-engineer (Sonnet) — en cours
- security-engineer (Sonnet) — en cours

## Etat en fin de session
Pipeline fonctionnel de bout en bout. La cle INSEE_API_KEY dans .env.local est l'ancien client_id (invalide) — il faut generer une nouvelle cle sur portail-api.insee.fr pour utiliser l'API Sirene primaire. Le fallback Recherche Entreprises fonctionne en attendant.
Prochaine etape : Appliquer les recommandations des agents d'audit, generer une nouvelle cle INSEE, finaliser les tests e2e.

---

## Session du : 2026-04-06 — Corrections majeures pipeline agent (8 correctifs)

## Objectif de cette session
Implémenter 8 corrections prioritaires sur le pipeline agent : fix ADEME Data Fair, enrichissement contact, validation BEGES, scoring 3 niveaux, anti-concurrent, settings sourcing, mode append, ADEME batch 20.

## Taches effectuees
- [x] BUG-01 : endpoint ADEME CKAN mort remplacé par API Data Fair
- [x] verifierBegesAdeme() réécrit pour Data Fair (tri desc, filtre SIREN exact)
- [x] enrichirProspect() : contact_nom, contact_poste, contact_email, beges_url, beges_valide
- [x] beges_valide = annee_reporting >= currentYear - 4
- [x] Scoring 3 niveaux BEGES : 0/15/20 pts
- [x] Protection anti-concurrent dans phaseInit (maybeSingle sur status=running)
- [x] phaseSourcing accepte settings, valide codes NAF via regex
- [x] Mode append daily_list : conserver les items appelés
- [x] ADEME_BATCH_SIZE 10 → 20
- [x] Fix bug préexistant br parasite ligne 74 daily-list/route.ts
- [x] tsc --noEmit : exit code 0

## Etat en fin de session
8 corrections implémentées. 0 erreur TypeScript. Pipeline ADEME opérationnel (Data Fair). Contact enrichi depuis ADEME. Scoring différencié. Protection run concurrent. Settings propagés.

---

## Session du : 2026-04-06 — Correction API Routes (6 bugs — BUG-04/05/06/08 + IMP-03/04)

## Objectif de cette session
Corriger 6 bugs dans les API routes Next.js 15 : fire-and-forget Vercel, date inconsistency, merge settings incomplet, semantique HTTP GET/POST, regex UUID permissive, run concurrent non protégé.

## Taches effectuees
- [x] BUG-04 : `after()` Next.js 15 remplace fire-and-forget dans daily-list/route.ts
- [x] BUG-08 : `const now = new Date()` / `const today` extraits en constante unique
- [x] IMP-03/BUG-05 : `notification_email` + `target_postal_codes` ajoutés au merge settings
- [x] Cast `as any` remplacé par `as unknown as Json` dans settings/route.ts
- [x] IMP-04 : handler GET → POST dans notifications/daily/route.ts
- [x] BUG-06 : UUID_REGEX RFC 4122 stricte dans feedback/route.ts
- [x] Vérification run concurrent (status=running → HTTP 409) dans agent/run/route.ts
- [x] Commentaires TODO pour import `@/lib/auth/cron` (module pas encore créé)

## Fichiers modifies
- app/api/daily-list/route.ts
- app/api/profile/settings/route.ts
- app/api/notifications/daily/route.ts
- app/api/daily-list/[id]/feedback/route.ts
- app/api/agent/run/route.ts

## Etat en fin de session
Toutes les corrections appliquées. 0 erreur TypeScript (`npx tsc --noEmit` exit code 0). `lib/auth/cron.ts` n'existe pas encore — les routes gardent une copie locale de `isCronRequest` avec TODO.
Prochaine etape : Créer `lib/auth/cron.ts`, migrer les TODO, écrire les tests unitaires des routes modifiées.

---

## Session du : 2026-04-06 — Fix pipeline : Lucene NAF, téléphone, sélection BEGES, pitch

## Objectif de cette session
4 corrections backend sur le pipeline agent : filtre INSEE Lucene malformé, enrichissement téléphone, filtre sélection BEGES, refonte approche pitch.

## Taches effectuees
- [x] Fix #1 : filtre NAF Lucene conditionnel dans `sourcerEntreprises()` — évite HTTP 400 sur liste vide
- [x] Fix #2 : fonction `rechercherTelephone(siren)` + appel dans `enrichirProspect()` → `contact_telephone`
- [x] Fix #3 : filtre `.or('beges_publie.eq.false,beges_valide.eq.false')` dans `phaseSelection()`
- [x] Fix #4 : `SYSTEM_PROMPT` et `INSTRUCTIONS` refondus — gains financiers/image en premier, ROI chiffré dans objections
- [x] Pitch fallback mis à jour avec la nouvelle approche
- [x] npx tsc --noEmit : exit code 0

## Fichiers modifies
- lib/agent/sourcing.ts
- lib/agent/orchestrator.ts
- lib/agent/pitch-gen.ts

---

## Session du : 2026-04-05 — Redesign Dashboard complet (layout, sidebar, header, pages)

## Objectif de cette session
Refondre l'UI du dashboard : layout, sidebar, header et les 3 pages principales (dashboard, daily-list, settings) pour un rendu SaaS moderne de niveau production inspiré de Linear/Vercel.

## Taches effectuees
- [x] Sidebar : active indicator (barre verte gauche), hover transitions, mobile tab bar avec top indicator, section logo enrichie avec sous-titre
- [x] DashboardHeader : avatar avec gradient, badge statut polie, pulse ring quand agent running, bouton play solid icon, glass effect backdrop-blur
- [x] Layout : wrapper main simplifie, padding coherent
- [x] Dashboard page : section "Bonjour {firstName}", MetricCard redesignee (icon + progress bar + %, tabular-nums), AgentPhaseTimeline (dots de progression), stats grid 4 colonnes, next calls avec badge numerote et arrow slide, CTA generate avec gradient green, empty state avec icon circle
- [x] Daily-list page : en-tete avec compteur, progress bar card separee avec %, vide states avec icon circle
- [x] Settings page : section compte avec avatar + info structurees, header avec h2 sous la ligne de separation

## Fichiers modifies
- components/layout/sidebar.tsx
- components/layout/dashboard-header.tsx
- app/(dashboard)/layout.tsx
- app/(dashboard)/dashboard/page.tsx
- app/(dashboard)/daily-list/page.tsx
- app/(dashboard)/settings/page.tsx

## Etat en fin de session
- 0 erreur TypeScript (npx tsc --noEmit — exit code 0)
- Logique metier et queries Supabase intactes
- Design cohererent Linear/Vercel avec green #16a34a comme accent
- Dark mode supporte partout

---

## Session du : 2026-04-05 — Redesign pages Prospects, Pipeline, et composants

## Objectif de cette session
Refonte visuelle de 8 fichiers : page prospects, page pipeline, pipeline-client, prospect-card, prospects-filters, daily-list-client, settings-form, generate-list-button. Zero modification de la logique metier ou des queries Supabase.

## Taches effectuees
- [x] ProspectsFilters : pill-style buttons avec dots couleurs, search avec icone loupe + spinner de debounce, slider score avec track visuel, pied de barre avec resume des filtres actifs + bouton reset
- [x] Prospects page : table Linear-inspired, sticky header avec texte uppercase, alternance lignes subtile, badges statut avec dots, score barre coloree (vert/jaune/gris selon niveau), pagination avec page active en vert, empty state avec icon loupe
- [x] Pipeline page : en-tete avec legende rapide des colonnes, compte par statut
- [x] PipelineClient : colonnes rounded-xl avec accent en tete, cards hover lift (-translate-y-0.5), empty state avec icon dashed border, modal avec bande couleur en haut, score badge colore (vert/jaune/gris)
- [x] ProspectCard : badges priorite (rouge/jaune/gris), section contact avec fond gris doux, sections expandables avec rounded-xl, boutons radio modernises en toggle grid 2 colonnes avec icones SVG, objections en blocs bicolores (rouge/vert), badges resultats avec dot colore
- [x] DailyListClient : stats du jour avec barre de progression + pourcentage, compteurs (restants/interesses/rappels), separation visuelle appels a faire / effectues, empty state illustre, message felicitations quand tout est fait
- [x] SettingsForm : sections card empilees avec icone coloree + description, checkboxes custom SVG, character counter sur textarea, slider avec track visuel, toasts error/success avec icone
- [x] GenerateListButton : CTA vert avec shimmer au survol, icone eclair (polygon), etats loading/success/error soignes

## Fichiers modifies
- app/(dashboard)/prospects/page.tsx
- app/(dashboard)/pipeline/page.tsx
- components/pipeline/pipeline-client.tsx
- components/daily-list/prospect-card.tsx
- components/daily-list/daily-list-client.tsx
- components/prospects/prospects-filters.tsx
- components/settings/settings-form.tsx
- components/dashboard/generate-list-button.tsx

## Etat en fin de session
- 0 erreur TypeScript (npx tsc --noEmit — exit code 0)
- Logique metier, queries Supabase, types TypeScript intacts
- Design cohererent Linear/Vercel avec green #16a34a comme accent
- Dark mode supporte sur tous les composants
- Accessibilite : aria-label, role, sr-only sur les elements interactifs

---

## Session du : 2026-04-06 — Mise a jour UI prospects (contact + BEGES + generation)

## Objectif de cette session
Mettre a jour les composants frontend pour afficher les nouvelles donnees prospects : email, BEGES, et bouton generation contextuel.

## Taches effectuees
- [x] prospect-card.tsx : email mailto + telephone tel toujours affiches (fallback "Non renseigne")
- [x] prospect-card.tsx : section statut BEGES avec badge vert/orange/rouge, date, lien beges_url
- [x] prospects/page.tsx : colonne BEGES entre Score et Statut, badge cliquable si beges_url
- [x] generate-list-button.tsx : props listItemCount/dailyTarget + texte contextuel + aide
- [x] daily-list/page.tsx : ajout contact_email, beges_url, beges_valide, beges_derniere_publication dans query Supabase

## Fichiers modifies cette session
- components/daily-list/prospect-card.tsx
- components/dashboard/generate-list-button.tsx
- app/(dashboard)/prospects/page.tsx
- app/(dashboard)/daily-list/page.tsx

## Etat en fin de session
- 0 erreur TypeScript (npx tsc --noEmit — exit code 0)
- Design coherent Linear/Vercel, dark mode sur tous les badges
- Accessibilite : aria-label, target="_blank" avec rel="noopener noreferrer" sur tous les liens externes

---

## Session du : 2026-04-06 — Debug dashboard : run échoué affiché au lieu du run récent

## Objectif de cette session
Diagnostiquer et corriger le bug d'affichage du dashboard qui montrait un run échoué alors que des runs réussis plus récents existaient, et corriger les métriques du jour potentiellement incorrectes.

## Causes racines identifiées

1. **Cache SSR Next.js 15 (Principal)** : absence de `export const dynamic = 'force-dynamic'` → Next.js 15 peut servir une version mise en cache du Server Component affichant un run échoué obsolète.
2. **`.limit(1)` redondant avant `.maybeSingle()`** : `.maybeSingle()` ajoute déjà `LIMIT 1` en interne (postgrest-js v2). Combinaison redondante supprimée.
3. **`.order(referencedTable)` + `.maybeSingle()` incompatibles** : trier une relation imbriquée via `referencedTable` sur la requête principale peut faire retourner plusieurs lignes à postgrest, ce qui fait échouer `.maybeSingle()` silencieusement (retourne `null`). Le tri était de toute façon déjà géré côté app via `.sort()`.
4. **Double `new Date()`** : `today` et `todayIso` calculés séparément — consolidés en `const nowDate = new Date()`.

## Fichiers modifies cette session
- app/(dashboard)/dashboard/page.tsx

## Etat en fin de session
- 0 erreur TypeScript (npx tsc --noEmit — exit code 0)
- 4 corrections apportées dans `dashboard/page.tsx`
