---
project: "Agent IA - Prospection Bilan Carbone"
domain: "saas"
type: "history"
created: "2026-04-05"
tags: [project/agent-ia---prospection-bilan-carbone, domain/saas, memory/history]
links:
  - "[[memory/MOC]]"
  - "[[memory/project-context]]"
---

# Prompt History — Agent IA - Prospection Bilan Carbone

> Historique des prompts optimisés utilisés sur ce projet.
> Ajoute tes nouveaux prompts en haut du fichier (ordre anti-chronologique).

---

## 2026-04-06 — Debug dashboard : run échoué affiché, métriques du jour incorrectes

**Type** : Bug Fix / Dashboard
**Modele** : claude-sonnet-4-6
**Score** : npx tsc --noEmit — exit code 0

### Taches effectuees

1. **`export const dynamic = 'force-dynamic'`** ajouté en tête de `dashboard/page.tsx` — interdit le cache SSR Next.js 15 qui servait un snapshot stale du run échoué.
2. **`.limit(1)` supprimé** avant `.maybeSingle()` sur la requête `agent_runs` — `.maybeSingle()` impose déjà `LIMIT 1` en interne (postgrest-js v2), la combinaison était redondante.
3. **`.order('ordre', { referencedTable: 'daily_list_items' })` supprimé** de la chaîne `daily_lists` — ce tri sur relation imbriquée peut faire retourner plusieurs lignes à postgrest et rend `.maybeSingle()` null silencieusement. Le tri est géré côté JS via `.sort()`.
4. **`const nowDate = new Date()`** — instance unique pour `today` et `todayIso`, élimine le bug potentiel "à minuit".

### Fichiers modifies
- `app/(dashboard)/dashboard/page.tsx`

---

## 2026-04-06 — Fix pipeline : filtre INSEE Lucene, enrichissement téléphone, filtre BEGES sélection, refonte pitch

**Type** : Backend / Bug Fix / Feature
**Modele** : claude-sonnet-4-6
**Score** : npx tsc --noEmit — exit code 0

### Taches effectuees

1. **Fix filtre INSEE Lucene vide** (`lib/agent/sourcing.ts`) : `nafCodes` vide après nettoyage produisait `activitePrincipaleEtablissement:()` → HTTP 400. Refactorisé en `queryParts[]` conditionnel : le filtre NAF n'est ajouté que si `cleanedNafCodes.length > 0`. Ajout `.trim().toUpperCase()` sur chaque code.
2. **Enrichissement téléphone** (`lib/agent/sourcing.ts`) : Nouvelle fonction `rechercherTelephone(siren)` qui interroge l'API Recherche Entreprises (`siege.telephone` → `matching_etablissements[].telephone`). Appel dans `enrichirProspect()`, résultat stocké dans `contact_telephone`. Non bloquant — silencieux si indisponible.
3. **Filtre BEGES dans phaseSelection** (`lib/agent/orchestrator.ts`) : Filtre `.or('beges_publie.eq.false,beges_valide.eq.false')` ajouté pour ne sélectionner que les prospects sans BEGES ou avec BEGES expiré. Les prospects conformes (`beges_valide = true`) sont exclus.
4. **Refonte approche pitch** (`lib/agent/pitch-gen.ts`) : `SYSTEM_PROMPT` réorienté — gains financiers (10-30% économies, financements BPI/ADEME, appels d'offres) et image de marque en premier, réglementation en appui. `INSTRUCTIONS` dans `buildUserPrompt()` renforcées : accroche DOIT mentionner un gain concret, objections DOIVENT inclure une réponse chiffrée sur le ROI. Pitch fallback également mis à jour pour respecter cette approche.

---

## 2026-04-06 — Mise a jour UI : contact, BEGES, bouton generation

**Type** : Feature / UI Enhancement
**Modele** : claude-sonnet-4-6
**Score** : npx tsc --noEmit — exit code 0

### Taches effectuees

1. **Email + telephone sur prospect-card** (`components/daily-list/prospect-card.tsx`) : Section contact enrichie avec champs email (`mailto:`) et telephone (`tel:`) toujours visibles (fallback "Non renseigné"). SVG inline, aria-label, design cohérent avec le reste de la carte.
2. **Section statut BEGES** (`components/daily-list/prospect-card.tsx`) : Nouvelle section permanente avec badge coloré (vert/orange/rouge) selon `beges_publie` + `beges_valide`, badge "Obligation BEGES", date de dernière publication, lien "Voir le BEGES" (`beges_url`) avec `target="_blank" rel="noopener noreferrer"`.
3. **Colonne BEGES dans table prospects** (`app/(dashboard)/prospects/page.tsx`) : Colonne BEGES insérée entre Score et Statut (visible `lg:`). Badge coloré cliquable si `beges_url` défini, affiche l'année de publication. ColSpan corrigé de 7 à 8.
4. **Bouton generation contextuel** (`components/dashboard/generate-list-button.tsx`) : Nouvelles props optionnelles `listItemCount` et `dailyTarget`. Texte adaptatif — "Générer la liste du jour" / "Compléter la liste" / "Ajouter de nouveaux prospects". Texte d'aide affiché sous le bouton (appels effectués conservés). Bouton jamais désactivé (sauf loading).
5. **Query Supabase daily-list** (`app/(dashboard)/daily-list/page.tsx`) : Ajout des colonnes `contact_email`, `beges_url`, `beges_valide`, `beges_derniere_publication` dans le SELECT nested prospects pour que les cards aient toutes les données.

### Fichiers modifies
- `components/daily-list/prospect-card.tsx`
- `components/dashboard/generate-list-button.tsx`
- `app/(dashboard)/prospects/page.tsx`
- `app/(dashboard)/daily-list/page.tsx`

### Validation
- `npx tsc --noEmit` : exit code 0, aucune erreur TypeScript
- Design cohérent Linear/Vercel, dark mode sur tous les badges
- Accessibilité : aria-label sur tous les liens, target="_blank" avec rel="noopener noreferrer"

---

## 2026-04-06 — Correction API Routes (6 bugs — BUG-04/05/06/08 + IMP-03/04)

**Type** : Bugfix / Security / Semantique HTTP
**Modele** : claude-sonnet-4-6
**Score** : npx tsc --noEmit — exit code 0

### Taches effectuees

1. **BUG-04 — Fire-and-forget** (`app/api/daily-list/route.ts`) : `runAgentNocturne` lancé en fire-and-forget tué par Vercel apres la reponse HTTP. Remplacé par `after()` (Next.js 15) qui garantit l'exécution post-réponse. Suppression du bloc `globalThis.waitUntil` + `@ts-expect-error`.
2. **BUG-08 — Date inconsistency** (`app/api/daily-list/route.ts`) : `new Date()` appelé 3 fois séparément. Extraites en `const now = new Date()` / `const today` au debut du handler pour cohérence garantie à minuit.
3. **IMP-03/BUG-05 — Merge settings incomplet** (`app/api/profile/settings/route.ts`) : `notification_email` et `target_postal_codes` valides par Zod mais jamais appliques dans le merge conditionnel → champs silencieusement ignores. Ajout des deux blocs `...(payload.X !== undefined && { X })` manquants. Cast `as any` remplacé par `as unknown as Json`.
4. **IMP-04 — GET → POST notifications** (`app/api/notifications/daily/route.ts`) : Handler GET renommé POST. Un GET qui envoie des emails et modifie l'état en base viole la sémantique HTTP (idempotence). Ajout commentaire TODO pour import `@/lib/auth/cron` quand disponible.
5. **BUG-06 — Regex UUID permissive** (`app/api/daily-list/[id]/feedback/route.ts`) : `/^[0-9a-f-]{36}$/` remplacée par `UUID_REGEX` RFC 4122 stricte validant variante (1-5) et variant bits ([89ab]).
6. **Concurrence agent/run** (`app/api/agent/run/route.ts`) : Ajout SELECT `status=running` avant lancement manuel → retourne HTTP 409 `RUN_IN_PROGRESS` si run concurrent. Import `timingSafeEqual` repositionné + commentaire TODO `lib/auth/cron.ts`.

### Fichiers modifies
- `app/api/daily-list/route.ts`
- `app/api/profile/settings/route.ts`
- `app/api/notifications/daily/route.ts`
- `app/api/daily-list/[id]/feedback/route.ts`
- `app/api/agent/run/route.ts`

### Validation
- `npx tsc --noEmit` : exit code 0, aucune erreur TypeScript

---

## 2026-04-06 — Corrections majeures pipeline agent (8 correctifs)

**Type** : Bugfix / Performance / Architecture
**Modele** : claude-sonnet-4-6
**Score** : tsc --noEmit exit code 0

### Taches effectuees
1. **BUG-01 CRITIQUE** — `lib/agent/sourcing.ts` : Remplacement endpoint ADEME CKAN mort par API Data Fair (`/data-fair/api/v1/datasets/bilan-ges/lines?q={siren}&size=5`)
2. **Enrichissement contact ADEME** — `lib/agent/sourcing.ts` : `enrichirProspect()` remplit `contact_nom`, `contact_poste`, `contact_email`, `beges_url` depuis les données Data Fair
3. **Validation BEGES** — `lib/agent/sourcing.ts` : calcul `beges_valide` (true si `annee_reporting >= année - 4`)
4. **Scoring BEGES 3 niveaux** — `lib/agent/scoring.ts` : pas de BEGES = +20 pts / BEGES expiré = +15 pts / BEGES valide = 0 pts
5. **CRIT-04 anti-concurrent** — `lib/agent/orchestrator.ts` : `phaseInit()` vérifie l'absence de run `status=running` avant INSERT
6. **IMP-08 settings au sourcing** — `lib/agent/orchestrator.ts` : `phaseSourcing()` accepte `settings`, valide les codes NAF, les passe à `sourcerEntreprises()` et au fallback
7. **Mode append daily list** — `lib/agent/orchestrator.ts` : supprime uniquement les items `called_at IS NULL`, conserve les appelés, continue la numérotation
8. **ADEME_BATCH_SIZE 10 → 20** — `lib/agent/orchestrator.ts` : +perf enrichissement (-50% durée batch ADEME)
9. **Bonus** — `app/api/daily-list/route.ts` : correction bug `<br>` parasite ligne 74 (TS1109 préexistant)

### Fichiers modifies
- `lib/agent/sourcing.ts`
- `lib/agent/scoring.ts`
- `lib/agent/orchestrator.ts`
- `app/api/daily-list/route.ts` (fix bug préexistant)

---

## 2026-04-06 — Fix Pipeline + Premiere Generation de Prospects

**Type** : Bugfix / Infrastructure / Integration
**Modele** : claude-opus-4-6
**Score** : non evalue

### Tache effectuee
Correction de 4 bugs bloquant le pipeline agent et premiere generation de prospects.

### Bugs corriges
1. **Middleware bloquait /api/* routes** — middleware.ts, ajout `isApiRoute` bypass
2. **INSEE OAuth2 mort** — sourcing.ts, remplacement OAuth2 par API Key (`X-INSEE-Api-Key-Integration`), nouvelle URL `api.insee.fr/api-sirene/3.11/siret`
3. **Fallback sourcing non declenche** — orchestrator.ts, fallback sur `etablissements.length === 0` (pas seulement sur throw)
4. **Format NAF dans fallback** — sourcing.ts, l'API Recherche Entreprises veut NAF AVEC point (`49.41A`)

### Fichiers modifies
- `middleware.ts` — bypass auth redirect pour /api/*
- `lib/agent/sourcing.ts` — supprime OAuth2, ajoute API Key, ajoute `sourcerEntreprisesFallback()`
- `lib/agent/orchestrator.ts` — import fallback, trigger sur 0 resultats
- `.env.local` — INSEE_CLIENT_ID/SECRET → INSEE_API_KEY

### Resultats
- Pipeline fonctionnel : 96 prospects sources, 96 qualifies, 15 pitchs generes
- Daily list "ready" pour le 2026-04-06
- Top prospects : Dassault Aviation (78), ArianeGroup (78), Airbus Atlantic (78)
- 0 erreur TypeScript

### Agents d'audit lances en parallele
- code-reviewer, debugger, performance-engineer, security-engineer

### Validation
- `npx tsc --noEmit` : 0 erreur
- `curl POST /api/agent/run` avec CRON_SECRET : succes, 96 prospects, liste generee
- Top 15 pitchs verifies dans daily_list_items

---

## 2026-04-06 — Audit Performance Pipeline Agent Nocturne (performance-engineer)

**Type** : Performance Engineering / Audit
**Modele** : claude-sonnet-4-6
**Score** : non evalué

### Tache effectuee
Audit complet du pipeline agent nocturne. Analyse du timing budget (7 phases), identification des 3 bottlenecks principaux, recommandation de 5 optimisations classées par impact/effort, analyse du frontend (First Load JS, middleware), analyse DB (index, RLS, pooling), et recommandations de scalabilité multi-user.

### Résultats clés
- Pipeline nominal : 62-93s / budget 300s (marge confortable)
- Bottleneck 1 : Pitchs GPT-4o séquentiels = 55-75% du temps total → paralléliser en groupes de 5
- Bottleneck 2 : Enrichissement ADEME 20 batchs séquentiels → doubler à batchs de 20
- Bottleneck 3 : 9 updateRunInDB intercalés = 360ms frais généraux
- Risque critique multi-user : token INSEE partagé + rate limit 30 req/min → blocage à partir de 5 users
- Index DB : complet et optimisé, migration 003 couvre le cas phaseSelection

### Fichiers analysés
- lib/agent/orchestrator.ts
- lib/agent/sourcing.ts
- lib/agent/scoring.ts
- lib/agent/pitch-gen.ts
- app/api/agent/run/route.ts
- supabase/migrations/001_initial.sql
- supabase/migrations/003_perf_indexes.sql
- middleware.ts
- next.config.ts

---

## 2026-04-05 — Redesign complet Prospects, Pipeline, ProspectCard, DailyList, Settings, GenerateButton

**Type** : Frontend / UI Redesign
**Modele** : claude-sonnet-4-6
**Score** : non evalue

### Tache effectuee
Refonte visuelle de 8 fichiers. Zero modification de la logique metier ou des queries Supabase.

Fichiers modifies :
- `app/(dashboard)/prospects/page.tsx` — table Linear-inspired, alternance lignes, badges avec dots, score barre coloree, pagination avec page active en vert, empty state illustre
- `app/(dashboard)/pipeline/page.tsx` — en-tete avec legende rapide des colonnes + count par statut
- `components/pipeline/pipeline-client.tsx` — colonnes rounded-xl + accent header, cards hover lift, modal avec bande couleur, score badge colore
- `components/daily-list/prospect-card.tsx` — badges priorite avec dot, toggle grid 2 colonnes avec icones SVG, section contact fond gris, objections bicolores, badges resultats avec dot
- `components/daily-list/daily-list-client.tsx` — stats avec barre de progression, separation visuelles, empty state illustre, message felicitations
- `components/prospects/prospects-filters.tsx` — pills avec dots couleurs, search + spinner debounce, slider avec track visuel, pied de barre resume filtres
- `components/settings/settings-form.tsx` — sections empilees avec icones colorees, checkboxes custom, character counter, slider track, toasts
- `components/dashboard/generate-list-button.tsx` — CTA vert avec shimmer hover, icone eclair, etats soignes

**Resultat** : 0 erreur TypeScript (npx tsc --noEmit exit code 0)

---

## 2026-04-05 — Redesign Dashboard UI (layout, sidebar, header, dashboard, daily-list, settings)

**Type** : Frontend / UI Redesign
**Modele** : claude-sonnet-4-6
**Score** : non evalue

### Tache effectuee
Refonte visuelle complete du dashboard SaaS. Toutes les queries Supabase et la logique metier sont preservees. Seuls le JSX et les classes Tailwind ont ete modifies.

1. **Sidebar** : indicateur actif (barre verte a gauche), transitions hover fluides, tab bar mobile avec indicateur horizontal en haut, section logo enrichie (sous-titre "Prospection IA"), icones unifiees a 18px.
2. **DashboardHeader** : avatar avec gradient green, badge statut avec checkmark SVG, pulse ring quand l'agent est running, bouton play avec icone solid (fill), glass effect via backdrop-blur-sm.
3. **Layout** : padding wrapper coherent, main scroll correct.
4. **Dashboard page** : section welcome "Bonjour {firstName}", MetricCard redesignee (icone dans cercle colore + progress bar + % + tabular-nums), AgentPhaseTimeline (6 phases en segments colorés), stats grid dans cards grises, next calls avec badge numero rond et fleche slide hover, CTA generate avec gradient green, empty state avec icone dans cercle.
5. **Daily-list page** : en-tete avec compteur appels, progress bar dans card separee avec %, etats vides avec icone dans cercle et texte hierarchise.
6. **Settings page** : section compte avec avatar gradient + donnees structurees avec labels UPPERCASE tracking, header titre sous ligne separatrice.

### Validation
- `npx tsc --noEmit` : 0 erreur

---

## 2026-04-05 — Fix Tailwind v4 + Redesign Landing Page + Auth Pages

**Type** : Frontend / Configuration / UI Redesign
**Modele** : claude-sonnet-4-6
**Score** : non evalue

### Tache effectuee
1. Corrige la configuration Tailwind CSS v4 : cree `postcss.config.mjs`, installe `@tailwindcss/postcss`, migre le theme de `tailwind.config.ts` vers `@theme` dans `globals.css`, supprime `tailwind.config.ts`.
2. Refonte complete de la landing page (`app/page.tsx`) : hero avec gradient anime, statistiques, section "comment ca marche" en 3 etapes, grille de fonctionnalites, CTA final, footer.
3. Refonte du layout auth (`app/(auth)/layout.tsx`) : split desktop (panneau gauche decoratif vert + formulaire droit), mobile-first (formulaire centre uniquement).
4. Simplification des pages login (`app/(auth)/login/page.tsx`) et signup (`app/(auth)/signup/page.tsx`) : carte glass avec shadow, liens croise, design coherent avec le layout.
5. Ajout des animations globales dans `globals.css` : gradient-shift, fade-in-up, float, classes animation-delay.

### Fichiers modifies
- `postcss.config.mjs` (NOUVEAU)
- `app/globals.css` (refonte @theme + animations)
- `tailwind.config.ts` (SUPPRIME — non utilise en Tailwind v4)
- `app/page.tsx` (refonte complete)
- `app/(auth)/layout.tsx` (refonte split layout)
- `app/(auth)/login/page.tsx` (refonte card design)
- `app/(auth)/signup/page.tsx` (refonte card design)

### Validation
- `npx tsc --noEmit` : 0 erreur TypeScript

---

## 2026-04-05 — Fix TypeScript après upgrade @supabase/supabase-js@2.101.1

**Type** : Bugfix / TypeScript compilation
**Modèle** : claude-sonnet-4-6
**Score** : ⭐⭐⭐⭐⭐

### Tâche effectuée
Correction de toutes les erreurs TypeScript après l'upgrade @supabase/supabase-js → 2.101.1 et @supabase/postgrest-js → 2.101.1.

### Fixes appliqués
1. `database.types.ts` : `interface Database` → `type Database =`
2. `server.ts` : export `SupabaseServerClient = ReturnType<typeof createServerClient<Database>>`
3. `orchestrator.ts` : remplace `SupabaseClient<Database>` par `SupabaseServerClient`, casts `as unknown as` sur les frontières Json↔types métier, cast `updatePayload` pour les logs AgentLog[]
4. Pages dashboard : `as Prospect[]` → `as unknown as Prospect[]`
5. Route daily-list : `as DailyListItem[]` → `as unknown as DailyListItem[]`
6. Route notifications : `as {...} | null` → `as unknown as {...} | null` (join profiles via auth.users)
7. `next.config.ts` : `typedRoutes` sorti de `experimental`
8. `package.json` : `@supabase/ssr` 0.6.1 → 0.10.0 (compatible @supabase/supabase-js@2.101.1)

### Résultat
`npx tsc --noEmit` — exit code 0, zéro erreur.

---

## 2026-04-05 — Initialisation du projet

**Type** : Initialisation / Setup
**Modèle** : claude-sonnet-4-6
**Score** : ⭐⭐⭐⭐⭐

### Prompt brut
L'agent travaille en amont : il fait tout le travail de recherche, qualification et préparation. L'humain n'a plus qu'à décrocher son téléphone avec une liste de 15 appels/jour, chacun accompagné d'un pitch sur-mesure. -- Il s'agit d'un agent avec une APP en mode SaaS (Supabase, Vercel, git) - donc structure le projet autour de cette plateforme) 

🧠 Compétences nécessaires (révisées)
1. Connaissance métier (inchangée)

Réglementation BEGES, ACV, Fresque du Climat
Secteurs prioritaires Bordeaux (viticulture, aérospatial, logistique, agro-alimentaire…)
Connaissance des interlocuteurs cibles selon l'offre (RSE, DRH, DAF, DG)

2. Sourcing & enrichissement de contacts

Requêter API Sirene pour filtrer entreprises éligibles (taille, secteur, localisation)
Croiser avec data.ademe.fr (BEGES déjà publiés = relance, jamais publiés = cible prioritaire)
Trouver le bon contact + numéro de téléphone : LinkedIn, site corporate, annuaires pro (Societe.com, Verif.com)
Enrichissement optionnel : Clearbit, Apollo, Dropcontact

3. Qualification & scoring

Score de priorité : obligation réglementaire, taille, secteur, maturité RSE, signaux d'intention
Classement pour alimenter une file de 15 meilleurs prospects/jour
Éviter les doublons et les entreprises déjà contactées

4. ✨ Génération du pitch téléphonique personnalisé

Rédiger un script d'appel court et contextualisé par prospect (pas un template générique)
Inclure : accroche sur l'actualité de l'entreprise, argument réglementaire si applicable, proposition de valeur, objections courantes + réponses
Adapter le ton selon l'interlocuteur (RSE vs DAF vs DG)

5. Mise en forme du livrable quotidien

Générer un document structuré (Notion, PDF, Google Doc…) chaque matin
Ordonner les 15 appels par priorité + meilleur créneau horaire estimé
Inclure toutes les infos utiles pour l'appel sans que l'humain ait besoin de chercher

6. Mémoire & suivi post-appel

Mettre à jour le statut après que l'humain ait renseigné le résultat (intéressé / rappeler / pas intéressé…)
Ne pas re-proposer un contact déjà appelé
Alimenter un pipeline simple (prospect → appelé → RDV → converti)


📋 Tâches de l'agent (révisées)
Chaque soir (run nocturne)
├── Sourcing
│   ├── Requêter Sirene → entreprises Bordeaux éligibles non encore contactées
│   ├── Croiser ADEME → prioriser celles sans BEGES publié
│   └── Trouver nom + téléphone du bon interlocuteur
│
├── Qualification & scoring
│   ├── Calculer score de priorité
│   ├── Sélectionner les 15 meilleurs prospects du lendemain
│   └── Vérifier qu'aucun n'a déjà été contacté (mémoire CRM)
│
├── Génération des pitchs
│   ├── Récupérer infos contextuelles sur chaque entreprise
│   │   (actualité, rapport RSE, offres d'emploi, taille exacte…)
│   ├── Générer un script d'appel personnalisé par prospect
│   └── Préparer les réponses aux objections courantes
│
└── Livrable
    ├── Compiler la liste des 15 appels du jour
    ├── Ordonner par priorité + heure conseillée
    └── Envoyer/publier le document (email, Notion, PDF…)

Chaque matin (optionnel)
└── Rappel synthétique : "Vos 15 appels du jour sont prêts"

Après les appels (input humain)
├── L'humain renseigne le résultat de chaque appel (form simple)
└── L'agent met à jour le CRM et adapte les prochaines sélections

📄 Format du livrable quotidien
Chaque fiche prospect ressemble à ça :
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📞 Appel #3 — PRIORITÉ HAUTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Entreprise  : Groupe Dumont Logistique
Secteur     : Transport & logistique
Effectif    : 620 salariés → BEGES obligatoire
Contact     : Marie Lefebvre, Responsable RSE
Téléphone   : 05 56 XX XX XX
Meilleur moment : 10h-11h ou 14h-15h

🎯 ACCROCHE
"Bonjour Mme Lefebvre, je vous appelle car votre groupe
dépasse le seuil des 500 salariés et est donc soumis
au BEGES réglementaire — j'ai vérifié, aucun bilan n'a
été publié à ce jour sur la plateforme ADEME..."

💬 PITCH
[2-3 phrases sur votre offre, adaptées au secteur logistique]

⚡ SIGNAUX DÉTECTÉS
- Offre d'emploi "Chargé RSE" publiée il y a 3 semaines
- Rapport DD non publié depuis 2021

🛡️ OBJECTIONS PROBABLES
- "On y travaille déjà" → "Parfait, on peut vous accompagner
   sur la partie réglementaire ou la consolidation des données…"
- "Pas le budget" → "Le BEGES est une obligation légale,
   le risque de non-conformité peut coûter plus cher…"

📋 RÉSULTAT (à remplir après l'appel)
[ ] Intéressé — RDV à fixer
[ ] Rappeler le ___
[ ] Pas intéressé
[ ] Mauvais contact
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🛠️ Stack technique (révisée)
ComposantOutilOrchestrationLangGraph (graph d'état, loop nocturne)LLM (pitch gen)Claude API — SonnetSourcingAPI Sirene, httpx + BeautifulSoup, Apollo/DropcontactCRM / mémoireNotion API ou SQLite + AirtableLivrableGénération PDF ou page Notion automatiqueSchedulingAPScheduler ou cron simpleFeedback humainForm Notion / Typeform / Airtable Form

🗺️ Roadmap
v0.1  Sourcing pipeline     → liste brute d'entreprises éligibles depuis Sirene
v0.2  Scoring & sélection   → top 15/jour, déduplication, mémoire
v0.3  Génération des pitchs → script personnalisé par prospect via Claude API
v0.4  Livrable              → document Notion ou PDF envoyé chaque matin
v0.5  Feedback loop         → l'humain renseigne les résultats, l'agent apprend
v1.0  Multi-offres          → extension ACV, Fresque du Climat

### Prompt optimisé

```xml
<role>
Tu es un expert développeur senior avec une expertise profonde en clean code, bonnes pratiques et architecture logicielle. Tu privilégies la lisibilité, la maintenabilité et la sécurité.
</role>

<context>
Avant de répondre, charge et lis les fichiers de contexte du projet (par ordre de priorité) :
- `CLAUDE.md` — règles, workflow et vue d'ensemble du projet
- `memory/project-context.md` — architecture, stack technique, décisions clés
- `memory/primer.md` — connaissance de fond, glossaire métier, règles du domaine
- `memory/session-context.md` — objectif et tâches de la session courante
- `memory/hindsight.md` — rétrospectives et pièges à éviter
- `memory/prompt-history.md` — historique des prompts et décisions passées

Si certains de ces fichiers n'existent pas encore, ignore-les et continue.

[Complète si pertinent :]
- Audience / utilisateur final : [À préciser]
- Enjeux ou contraintes spécifiques : [À préciser]
- Environnement technique ou organisationnel : [À préciser]
</context>

<instructions>
1. Analyse la demande et identifie le comportement attendu
2. Implémente la solution en suivant les bonnes pratiques du langage
3. Ajoute des commentaires uniquement où la logique n'est pas évidente
4. Indique si des tests ou validations supplémentaires sont recommandés

Important : cette tâche est complexe. Prends le temps nécessaire pour produire un résultat de haute qualité. Va au-delà du minimum.
</instructions>

<constraints>
- Respecte les conventions du langage cible
- Code fonctionnel et testé mentalement avant de répondre
- Pas de sur-ingénierie — solution la plus simple qui fonctionne
- [AJOUTER contraintes spécifiques : version Python/Node/etc.]
</constraints>

<examples>
  <!-- Ajoute 3-5 exemples représentatifs de l'output attendu -->
  <example>
    <input>[exemple d'entrée]</input>
    <output>[exemple de sortie attendue]</output>
  </example>
</examples>

<!-- Chain-of-Thought : décommente si tu veux voir le raisonnement -->
<!-- Avant de répondre, réfléchis étape par étape dans <thinking>.
     Donne ta réponse finale dans <answer>. -->

<input>
L'agent travaille en amont : il fait tout le travail de recherche, qualification et préparation. L'humain n'a plus qu'à décrocher son téléphone avec une liste de 15 appels/jour, chacun accompagné d'un pitch sur-mesure. -- Il s'agit d'un agent avec une APP en mode SaaS (Supabase, Vercel, git) - donc structure le projet autour de cette plateforme) 

🧠 Compétences nécessaires (révisées)
1. Connaissance métier (inchangée)

Réglementation BEGES, ACV, Fresque du Climat
Secteurs prioritaires Bordeaux (viticulture, aérospatial, logistique, agro-alimentaire…)
Connaissance des interlocuteurs cibles selon l'offre (RSE, DRH, DAF, DG)

2. Sourcing & enrichissement de contacts

Requêter API Sirene pour filtrer entreprises éligibles (taille, secteur, localisation)
Croiser avec data.ademe.fr (BEGES déjà publiés = relance, jamais publiés = cible prioritaire)
Trouver le bon contact + numéro de téléphone : LinkedIn, site corporate, annuaires pro (Societe.com, Verif.com)
Enrichissement optionnel : Clearbit, Apollo, Dropcontact

3. Qualification & scoring

Score de priorité : obligation réglementaire, taille, secteur, maturité RSE, signaux d'intention
Classement pour alimenter une file de 15 meilleurs prospects/jour
Éviter les doublons et les entreprises déjà contactées

4. ✨ Génération du pitch téléphonique personnalisé

Rédiger un script d'appel court et contextualisé par prospect (pas un template générique)
Inclure : accroche sur l'actualité de l'entreprise, argument réglementaire si applicable, proposition de valeur, objections courantes + réponses
Adapter le ton selon l'interlocuteur (RSE vs DAF vs DG)

5. Mise en forme du livrable quotidien

Générer un document structuré (Notion, PDF, Google Doc…) chaque matin
Ordonner les 15 appels par priorité + meilleur créneau horaire estimé
Inclure toutes les infos utiles pour l'appel sans que l'humain ait besoin de chercher

6. Mémoire & suivi post-appel

Mettre à jour le statut après que l'humain ait renseigné le résultat (intéressé / rappeler / pas intéressé…)
Ne pas re-proposer un contact déjà appelé
Alimenter un pipeline simple (prospect → appelé → RDV → converti)


📋 Tâches de l'agent (révisées)
Chaque soir (run nocturne)
├── Sourcing
│   ├── Requêter Sirene → entreprises Bordeaux éligibles non encore contactées
│   ├── Croiser ADEME → prioriser celles sans BEGES publié
│   └── Trouver nom + téléphone du bon interlocuteur
│
├── Qualification & scoring
│   ├── Calculer score de priorité
│   ├── Sélectionner les 15 meilleurs prospects du lendemain
│   └── Vérifier qu'aucun n'a déjà été contacté (mémoire CRM)
│
├── Génération des pitchs
│   ├── Récupérer infos contextuelles sur chaque entreprise
│   │   (actualité, rapport RSE, offres d'emploi, taille exacte…)
│   ├── Générer un script d'appel personnalisé par prospect
│   └── Préparer les réponses aux objections courantes
│
└── Livrable
    ├── Compiler la liste des 15 appels du jour
    ├── Ordonner par priorité + heure conseillée
    └── Envoyer/publier le document (email, Notion, PDF…)

Chaque matin (optionnel)
└── Rappel synthétique : "Vos 15 appels du jour sont prêts"

Après les appels (input humain)
├── L'humain renseigne le résultat de chaque appel (form simple)
└── L'agent met à jour le CRM et adapte les prochaines sélections

📄 Format du livrable quotidien
Chaque fiche prospect ressemble à ça :
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📞 Appel #3 — PRIORITÉ HAUTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Entreprise  : Groupe Dumont Logistique
Secteur     : Transport & logistique
Effectif    : 620 salariés → BEGES obligatoire
Contact     : Marie Lefebvre, Responsable RSE
Téléphone   : 05 56 XX XX XX
Meilleur moment : 10h-11h ou 14h-15h

🎯 ACCROCHE
"Bonjour Mme Lefebvre, je vous appelle car votre groupe
dépasse le seuil des 500 salariés et est donc soumis
au BEGES réglementaire — j'ai vérifié, aucun bilan n'a
été publié à ce jour sur la plateforme ADEME..."

💬 PITCH
[2-3 phrases sur votre offre, adaptées au secteur logistique]

⚡ SIGNAUX DÉTECTÉS
- Offre d'emploi "Chargé RSE" publiée il y a 3 semaines
- Rapport DD non publié depuis 2021

🛡️ OBJECTIONS PROBABLES
- "On y travaille déjà" → "Parfait, on peut vous accompagner
   sur la partie réglementaire ou la consolidation des données…"
- "Pas le budget" → "Le BEGES est une obligation légale,
   le risque de non-conformité peut coûter plus cher…"

📋 RÉSULTAT (à remplir après l'appel)
[ ] Intéressé — RDV à fixer
[ ] Rappeler le ___
[ ] Pas intéressé
[ ] Mauvais contact
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🛠️ Stack technique (révisée)
ComposantOutilOrchestrationLangGraph (graph d'état, loop nocturne)LLM (pitch gen)Claude API — SonnetSourcingAPI Sirene, httpx + BeautifulSoup, Apollo/DropcontactCRM / mémoireNotion API ou SQLite + AirtableLivrableGénération PDF ou page Notion automatiqueSchedulingAPScheduler ou cron simpleFeedback humainForm Notion / Typeform / Airtable Form

🗺️ Roadmap
v0.1  Sourcing pipeline     → liste brute d'entreprises éligibles depuis Sirene
v0.2  Scoring & sélection   → top 15/jour, déduplication, mémoire
v0.3  Génération des pitchs → script personnalisé par prospect via Claude API
v0.4  Livrable              → document Notion ou PDF envoyé chaque matin
v0.5  Feedback loop         → l'humain renseigne les résultats, l'agent apprend
v1.0  Multi-offres          → extension ACV, Fresque du Climat
</input>

<output_format>
1. Code complet et fonctionnel
2. Explication courte des choix techniques (si non évidents)
3. [OPTIONNEL] Exemple d'utilisation
</output_format>
```

### Notes
Prompt généré automatiquement lors de l'initialisation du projet via Claude Prompt Optimizer.

---

## 2026-04-05 — DevOps CI/CD + Sentry Next.js 15

**Type** : Infrastructure / DevOps
**Modele** : claude-sonnet-4-6
**Score** : En cours d'évaluation

### Tâche effectuée
Verification, amélioration et création des fichiers DevOps pour le pipeline CI/CD GitHub Actions et l'intégration Sentry Next.js 15.

### Ce qui a été produit
- `.github/workflows/ci.yml` améliore : jobs lint/typecheck/test en parallele, build avec needs, cache `.next/cache`, variables SENTRY fictives pour `withSentryConfig`
- `.github/workflows/deploy-preview.yml` : gate tests avant deploy, Vercel CLI, commentaire PR mis a jour (upsert)
- `sentry.server.config.ts` améliore : `instrumentationHook: true`, `profilesSampleRate: 0.05`, `skipOpenTelemetrySetup: true`
- `sentry.edge.config.ts` : config Edge runtime sans profiling natif
- `instrumentation.ts` : `register()` avec dispatch nodejs/edge + `onRequestError = Sentry.captureRequestError`
- `app/global-error.tsx` : error boundary global `'use client'`, `useEffect` → `captureException` avec tag `digest`, UI dark mode inline styles, affichage digest en dev uniquement

### Fichiers créés / modifiés
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-preview.yml`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`
- `instrumentation.ts`
- `app/global-error.tsx`

### Secret GitHub Actions à configurer
- `VERCEL_TOKEN` — token Vercel pour deploy-preview.yml
- `VERCEL_ORG_ID` — optionnel si vercel pull le résout automatiquement
- `VERCEL_PROJECT_ID` — optionnel si vercel pull le résout automatiquement

---

## 2026-04-05 — Migration SQL initiale (Etape 3 du plan)

**Type** : Database / Infrastructure
**Modèle** : claude-sonnet-4-6
**Score** : En cours d'évaluation

### Tâche effectuée
Génération de `supabase/migrations/001_initial.sql` — schéma complet production-ready.

### Ce qui a été produit
- 5 tables : `profiles`, `prospects`, `daily_lists`, `daily_list_items`, `agent_runs`
- 6 types ENUM : `prospect_status`, `daily_list_status`, `contact_type`, `call_result`, `call_priority`, `agent_run_status`
- 2 fonctions : `set_updated_at()`, `handle_new_user()`
- 4 triggers `updated_at` + 1 trigger `handle_new_user` sur `auth.users`
- RLS activé sur les 5 tables (4 policies SELECT/INSERT/UPDATE/DELETE par table)
- 12 index couvrant les patterns d'accès principaux
- Contraintes UNIQUE : `(user_id, siren)` sur prospects, `(user_id, date)` sur daily_lists
- COMMENT SQL sur toutes les tables et colonnes complexes

### Fichier créé
`supabase/migrations/001_initial.sql` — 709 lignes

---

## 2026-04-05 — Auth Layer complet (Étape 4)

**Type** : Feature / Auth
**Modèle** : claude-sonnet-4-6
**Score** : En cours d'évaluation

### Tâche effectuée
Création complète de la couche d'authentification Next.js 15 + Supabase Auth.

### Ce qui a été produit
- `components/auth/login-form.tsx` — Client Component "use client", 2 modes (password / magic link), erreurs Supabase traduites en français, spinner de chargement, state machine simple
- `components/auth/signup-form.tsx` — Client Component "use client", validation Zod (email, password 8 car + maj + chiffre, confirmation), indicateur visuel de force mot de passe, écran de succès post-inscription
- `app/(auth)/layout.tsx` — Layout Server Component centré (flexbox), logo SVG inline, fond dégradé vert-50, footer minimal
- `app/(auth)/login/page.tsx` — Server Component avec metadata SEO, importe LoginForm
- `app/(auth)/signup/page.tsx` — Server Component avec metadata SEO + encart value proposition, importe SignupForm
- `app/auth/callback/route.ts` — GET handler échange code PKCE (`exchangeCodeForSession`), protection open redirect sur `next`, logging erreur Sentry-compatible
- `app/auth/confirm/route.ts` — GET handler vérification OTP (`verifyOtp`), gère magic link + email confirm + recovery, messages d'erreur différenciés (expiré vs invalide)

### Décisions techniques
- Validation côté client via Zod (déjà en dépendance) — pas de lib UI tierce
- Erreurs Supabase Auth traduites via une map statique en français
- Protection open redirect dans callback et confirm : `next.startsWith('/')` obligatoire
- `router.refresh()` après `signInWithPassword` pour forcer le rechargement des Server Components et déclencher le middleware de redirection
- Icônes SVG inline — pas de `lucide-react` ni `heroicons` (non encore installé)
- `emailRedirectTo` dans signInWithOtp pointe vers `/auth/confirm`, dans signUp vers `/auth/callback`

### Fichiers créés
- `components/auth/login-form.tsx`
- `components/auth/signup-form.tsx`
- `app/(auth)/layout.tsx`
- `app/(auth)/login/page.tsx`
- `app/(auth)/signup/page.tsx`
- `app/auth/callback/route.ts`
- `app/auth/confirm/route.ts`

---

## 2026-04-05 — Agent Core : sourcing, scoring, pitch-gen, orchestrateur (Étape 5)

**Type** : Feature / Agent Core
**Modèle** : claude-sonnet-4-6
**Score** : En cours d'évaluation

### Tâche effectuée
Création complète des 4 modules du coeur de l'agent nocturne + tests unitaires scoring.

### Ce qui a été produit

**lib/agent/sourcing.ts**
- `getInseeBearerToken()` : OAuth2 Client Credentials INSEE, cache mémoire 7j avec marge 1min, retry x2 sur 5xx
- `sourcerEntreprises()` : pagination automatique Sirene v3.11, filtres Lucene (dept 33, tranches 31-53, secteurs NAF prioritaires, état A), rate limit 2100ms/page (28 req/min)
- `verifierBegesAdeme()` : lookup CKAN datastore_search par SIREN, parse flexible des noms de colonnes, null-safe
- `enrichirProspect()` : conversion SireneEtablissement → Partial<Prospect>, raison sociale avec fallback, tranche → effectifMin/Max, adresse reconstituée, obligation BEGES (tranche >= 41)

**lib/agent/scoring.ts**
- `calculerScore()` : score 0-100 clampé, 7 critères pondérés + 2 pénalités
- `getScoreDetails()` : décomposition ScoreDetails par critère
- `determinerPriorite()` : haute (>=60) / normale (>=30) / basse (<30)
- `estSecteurPrioritaire()` : lookup O(1) via Set, normalisation codes NAF avec/sans point

**lib/agent/pitch-gen.ts**
- `genererPitch()` : prompt système expert BEGES, response_format json_object, parse sécurisé, fallback contact_type
- `genererPitchsBatch()` : séquentiel 500ms entre chaque, pitch fallback si erreur individuelle (ne bloque pas le batch)
- `_pitchFallback()` : pitch générique différencié selon obligation_beges

**lib/agent/orchestrator.ts**
- `runAgentNocturne()` : 8 phases séquentielles avec fail-graceful individuel
  - Phase 1 : création agent_run en DB (status=running)
  - Phase 2 : chargement ProfileSettings depuis profiles
  - Phase 3 : sourcing Sirene + déduplication par SIREN + enrichissement ADEME
  - Phase 4 : scoring + upsert par batch de 50 (évite les timeouts)
  - Phase 5 : sélection top N prospects (statut sourced/qualified, score DESC)
  - Phase 6 : génération pitchs GPT-4o
  - Phase 7 : upsert daily_list (idempotent) + insert items + status→ready
  - Phase 8 : finalisation (status=completed, completed_at, métriques)
- `log()` : mutation run.logs + console.log JSON avec run_id/user_id pour correlation
- `updateRunInDB()` : never throw — erreur DB loggée mais non fatale

**lib/agent/__tests__/scoring.test.ts**
- 9 cas de test Vitest (pattern AAA) :
  1. Prospect idéal → score 81
  2. Prospect rejeté → pénalité -50
  3. Prospect déjà contacté → pénalité -20
  4. Prospect faible priorité → score 3
  5. Score plancher → jamais négatif (clamp à 0)
  6. Signaux intention → plafond 15 pts
  7. estSecteurPrioritaire → normalisation codes NAF
  8. determinerPriorite → 3 seuils
  9. getScoreDetails → cohérence somme = calculerScore

### Décisions techniques
- Cache token INSEE en mémoire (module-level singleton) — compatible serverless warm (Vercel)
- Type `DailyListInsert` local dans orchestrateur pour gérer null vs undefined Supabase
- `genererPitchsBatch` continue même si GPT-4o échoue sur un prospect (fallback)
- Orchestrateur : phases 3 et 4 non-fatales (continue avec prospects existants en DB), phases 2, 5, 7 fatales (run → status=failed)
- Aucun `any` TypeScript — strict mode complet

### Fichiers créés
- `lib/agent/sourcing.ts`
- `lib/agent/scoring.ts`
- `lib/agent/pitch-gen.ts`
- `lib/agent/orchestrator.ts`
- `lib/agent/__tests__/scoring.test.ts`

---

## 2026-04-05 — API Routes Next.js 15 (Étape 6)

**Type** : Feature / API Routes
**Modèle** : claude-sonnet-4-6
**Score** : En cours d'évaluation

### Tâche effectuée
Création des 7 API Routes Next.js 15 App Router avec auth Supabase, validation Zod, erreurs standardisées.

### Ce qui a été produit

**app/api/agent/run/route.ts** (POST, maxDuration=300)
- Double protection : CRON_SECRET (comparaison temps constant) OU session Supabase
- Mode cron : récupère tous les users onboardés, lance runAgentNocturne() en parallèle via Promise.allSettled
- Mode manuel : vérifie que body.userId correspond au user connecté (anti-usurpation)
- Erreurs internes masquées en prod (détails uniquement en NODE_ENV=development)

**app/api/agent/status/route.ts** (GET)
- 3 requêtes Supabase en parallèle : dernier run, liste du jour, count appels du jour
- Non-bloquant sur erreurs individuelles — retourne ce qui est disponible

**app/api/notifications/daily/route.ts** (GET, cron only)
- Protection CRON_SECRET uniquement
- Jointure profiles dans la query pour récupérer email + settings + items en une requête
- Anti-double envoi via notified_at IS NULL
- topProspects construits depuis les 3 premiers items (pour l'email Resend)
- Formatage date humain "dimanche 5 avril 2026" via Intl.DateTimeFormat
- Mise à jour atomic : notified_at + status='completed' dans la même update

**app/api/daily-list/route.ts** (GET)
- Query param date validé par regex YYYY-MM-DD
- Jointure daily_list_items + prospects dans une seule requête Supabase
- Génération background fire-and-forget si liste absente pour la date du jour
- waitUntil si disponible (Vercel Edge), sinon fire-and-forget avec catch logging

**app/api/daily-list/[id]/feedback/route.ts** (PATCH)
- Validation Zod avec .refine() : callback_date obligatoire si call_result='callback'
- Ownership vérifié en 2 étapes : récupération de l'item (+ prospect_id) puis update avec .eq('user_id')
- Mapping CALL_RESULT_TO_STATUS : Record<CallResult, ProspectStatus | null>
- Mise à jour prospect non-fatale (log warn si erreur, item déjà mis à jour)

**app/api/prospects/route.ts** (GET + POST)
- GET : filtres dynamiques (statut, secteur ilike, search OR raison_sociale/siren/ville), pagination range(), count exact
- POST : vérif doublon SIREN avant insert + catch contrainte unique 23505 (race condition)
- Constantes MAX_LIMIT=100, DEFAULT_LIMIT=20

**app/api/prospects/[id]/route.ts** (GET + PATCH + DELETE)
- Validation UUID par regex dans helper isValidUUID()
- PATCH : refuse body vide (EMPTY_UPDATE 400)
- DELETE : check existence avant suppression pour 404 propre, retourne 204 No Content

### Fichiers créés
- `app/api/agent/run/route.ts`
- `app/api/agent/status/route.ts`
- `app/api/notifications/daily/route.ts`
- `app/api/daily-list/route.ts`
- `app/api/daily-list/[id]/feedback/route.ts`
- `app/api/prospects/route.ts`
- `app/api/prospects/[id]/route.ts`
- `supabase/migrations/002_daily_lists_notified_at.sql`
- `lib/supabase/database.types.ts` (modifié — ajout notified_at)

### Décisions techniques
- Comparaison CRON_SECRET en temps constant (bitwise XOR) pour éviter les timing attacks
- createAdminClient() pour l'orchestrateur uniquement — createClient() pour les endpoints user
- Zod .refine() pour les validations cross-champs (callback_date conditionnel)
- Promise.allSettled() pour le mode cron multi-user (un run qui échoue n'arrête pas les autres)
- 204 No Content sur DELETE (pas de body à retourner)
- Erreurs DB loggées en JSON structuré avec route + message, sans exposer les détails utilisateur

---

## 2026-04-05 — Système Emails Resend + React Email (Étape 8)

**Type** : Feature / Emails transactionnels
**Modèle** : claude-sonnet-4-6
**Score** : En cours d'évaluation

### Tâche effectuée
Création du système d'emails complet : client Resend, template notification quotidienne, template bienvenue.

### Ce qui a été produit

**lib/email/send.ts**
- `sendEmail()` privée : guard RESEND_FROM_EMAIL + RESEND_API_KEY, catch complet, log JSON structuré avec level/service/to/subject/resend_id
- `sendDailyReadyEmail()` : subject formaté avec callsCount + date, React.createElement pour compat SSR
- `sendWelcomeEmail()` : subject fixe, React.createElement WelcomeEmail
- Toutes les fonctions retournent `{ success: boolean }` — jamais de throw, l'email ne plante jamais le run agent

**lib/email/templates/daily-ready.tsx**
- Header vert #16a34a avec logo "DecarbonLeads" + tagline "by STROFE" + date à droite
- Hero centré : emoji check, titre "Vos N appels sont prêts", sous-titre personnalisé
- 3 cartes prospects : numéro de classement (rond vert), nom + secteur, badge priorité coloré (HAUTE=rouge, NORMALE=orange, BASSE=gris), score/100
- CTA bouton vert centré vers appUrl
- Section 3 colonnes (Sourcing / Qualification / Vous appelez) pour rappeler la valeur produit
- Footer : désabonnement via lien /dashboard/settings#notifications

**lib/email/templates/welcome.tsx**
- Header centré vert
- Hero : emoji plante, titre "Bienvenue sur DecarbonLeads, {userName} !"
- Section "Comment ça marche" : 3 étapes numérotées (rond vert), icône + titre + description
- CTA section fond vert-50 : "Configurer mon agent" vers /dashboard/settings
- Section tips : 3 cartes (Votre offre / Vos secteurs / Zone géo) avec icône + description
- Bloc rassurant fond amber : invitation à répondre à l'email si besoin

### Décisions techniques
- `React.createElement()` dans send.ts plutôt que JSX — send.ts est un fichier .ts, pas .tsx
- `PRIORITY_CONFIG` comme Record<string, ...> dans daily-ready.tsx pour gérer les valeurs en minuscules ou majuscules (normalize)
- `topProspects.slice(0, 3)` dans le template — sécurité si l'appelant passe plus de 3
- `settingsUrl` calculé depuis `NEXT_PUBLIC_APP_URL` avec fallback en dur dans welcome.tsx — l'env var est disponible côté serveur dans les templates RSC
- Apostrophes françaises interdites dans les string literals TypeScript (TS1005) — utiliser double-quotes pour les strings contenant des apostrophes

### Fichiers créés
- `lib/email/send.ts`
- `lib/email/templates/daily-ready.tsx`
- `lib/email/templates/welcome.tsx`
- `package.json` (modifié — @react-email/components ^0.0.32)

---

## 2026-04-05 — Dashboard UI complet (Étape 7)

**Type** : Feature / UI
**Modèle** : claude-sonnet-4-6
**Score** : En cours d'évaluation

### Tâche effectuée
Création complète du dashboard : layout, sidebar, 5 pages, 7 composants, 1 API route.

### Ce qui a été produit

**app/(dashboard)/layout.tsx** — Server Component. Récupère session + profil + statut agent en parallèle. Rend Sidebar + DashboardHeader + main.

**app/(dashboard)/dashboard/page.tsx** — 4 métriques (préparés/appelés/intéressés/RDV), statut dernier run agent, bouton Générer demain (via GenerateListButton), 3 prochains appels avec liens vers /daily-list.

**app/(dashboard)/daily-list/page.tsx** — Titre avec date, badge statut liste (4 états), barre de progression, état vide (no list), état generating (spinner), DailyListClient avec les items triés par ordre.

**app/(dashboard)/prospects/page.tsx** — Table avec 7 colonnes (responsive), tri par colonne via searchParams → URL, filtres statut/secteur/score min via ProspectsFilters, pagination 20/page, mini barre de score visuelle.

**app/(dashboard)/pipeline/page.tsx** — Récupère prospects filtrés sur 5 statuts, groupe par status, passe à PipelineClient.

**app/(dashboard)/settings/page.tsx** — Récupère profil + settings JSONB, render infos compte + SettingsForm.

**components/layout/sidebar.tsx** — Logo SVG inline, 5 liens nav avec icônes SVG inline, indicateur actif usePathname, section bas settings + logout (signOut Supabase), bottom nav mobile.

**components/layout/dashboard-header.tsx** — Badge AgentStatusBadge (4 variantes avec dot animé), bouton "Lancer l'agent" POST /api/agent/run, loading state, reload page on success.

**components/dashboard/generate-list-button.tsx** — Bouton outlined vert, POST /api/agent/run avec body { target: 'tomorrow' }, état succès persistant.

**components/daily-list/daily-list-client.tsx** — Wrapper 'use client', state local des items, callback handleFeedbackSubmit pour mise à jour optimiste.

**components/daily-list/prospect-card.tsx** — Carte complète : en-tête priorité colorée (border-l-4), infos contact avec lien tel:, ExpandableSection pour accroche/pitch/signaux/objections, formulaire radio + date picker + textarea, PATCH /api/daily-list/[id]/feedback, card grisée avec badge résultat après soumission.

**components/prospects/prospects-filters.tsx** — Statuts multi-select (boutons toggle), input secteur (blur + enter), slider score min, bouton reset, useTransition pour UX smooth.

**components/pipeline/pipeline-client.tsx** — Kanban 5 colonnes scroll horizontal, COLUMN_STYLES par couleur, ProspectModal avec boutons prev/next status (PATCH /api/prospects/[id]), mise à jour état local optimiste.

**components/settings/settings-form.tsx** — Textarea offre, checkboxes secteurs 15 options, input ville, slider daily_call_target 5-20, PATCH /api/profile/settings, feedback success/error.

**app/api/profile/settings/route.ts** — PATCH avec validation manuelle (sans Zod pour légèreté), merge des settings JSONB existants, guard email obligatoire, UPDATE (pas upsert) car profil créé par trigger auth.

### Décisions techniques
- Server Components pour toutes les pages (fetch Supabase server-side)
- Isolation Client Components minimale : uniquement ce qui nécessite hooks ou events
- TailwindCSS pur — aucun shadcn, aucune lib UI
- Mise à jour optimiste côté client pour ProspectCard et PipelineClient
- searchParams pour filtres/pagination dans ProspectsPage (URL-driven state)
- useTransition dans ProspectsFilters pour feedback de chargement
- `redirect()` de Next.js est noreturn — cast `user as NonNullable<typeof user>` nécessaire dans le layout
- cast `as any` dans api/profile/settings pour contourner les types Supabase pré-existants incorrects (not newly introduced)

### Fichiers créés
- `app/(dashboard)/layout.tsx`
- `app/(dashboard)/dashboard/page.tsx`
- `app/(dashboard)/daily-list/page.tsx`
- `app/(dashboard)/prospects/page.tsx`
- `app/(dashboard)/pipeline/page.tsx`
- `app/(dashboard)/settings/page.tsx`
- `components/layout/sidebar.tsx`
- `components/layout/dashboard-header.tsx`
- `components/dashboard/generate-list-button.tsx`
- `components/daily-list/daily-list-client.tsx`
- `components/daily-list/prospect-card.tsx`
- `components/prospects/prospects-filters.tsx`
- `components/pipeline/pipeline-client.tsx`
- `components/settings/settings-form.tsx`
- `app/api/profile/settings/route.ts`

<!-- Ajoute tes nouveaux prompts ci-dessus avec le même format -->
