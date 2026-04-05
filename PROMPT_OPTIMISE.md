# Résultats — Agent IA - Prospection Bilan Carbone

> Généré le 2026-04-05 à 00:46 par **Claude Prompt Optimizer**

---

## ✨ Prompt optimisé

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

---

## 📊 Analyse du prompt

| Paramètre | Valeur |
|-----------|--------|
| **Domaine détecté** | SaaS / B2B 📊 |
| **Type de tâche** | `code` |
| **Complexité** | 🔴 Haute |
| **Modèle recommandé** | 🎵 Claude Sonnet 4.6 |
| **Few-shot examples** | ✅ Recommandés |
| **Chain-of-Thought** | ✅ Recommandé |
| **Mode agentique** | ❌ Non |

---

## 🔧 Configuration API

```python
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=16384,
    thinking={"type": "enabled", "budget_tokens": 16384},
    output_config={"effort": "high"},
    messages=[{
        "role": "user",
        "content": """[COLLE LE PROMPT OPTIMISÉ CI-DESSUS]"""
    }]
)
```

---

## 💡 Conseils spécifiques — SaaS / B2B

📊 **Analytics avant les features** : implémente le tracking (PostHog/Mixpanel) avant même d'écrire la première feature
🔄 **Onboarding = rétention** : les 5 premières minutes d'utilisation déterminent si l'utilisateur reviendra
💰 **Billing robuste** : teste les scénarios edge Stripe (échec, rétractation, upgrade/downgrade) maintenant
🚀 **Feature flags dès le début** : pour déployer graduellement et rollback sans douleur

---

## 📁 Fichiers générés (à copier dans ton projet)

| Fichier | Description |
|---------|-------------|
| `.github/copilot-instructions.md` | Instructions Copilot tailored pour SaaS / B2B |
| `.github/prompts/main-prompt.prompt.md` | Ce prompt comme slash command `/main-prompt` |
| `memory/project-context.md` | Contexte projet **(à compléter)** |
| `memory/session-context.md` | Template de suivi de session |
| `memory/prompt-history.md` | Historique initialisé avec ce prompt |

---

## ⚡ Prochaines étapes

1. **Copie** ce dossier entier dans la racine de ton projet `Agent IA - Prospection Bilan Carbone/`
2. **Complète** les `[PLACEHOLDERS]` dans `memory/project-context.md`
3. **Ouvre VS Code** — GitHub Copilot lira automatiquement `.github/copilot-instructions.md`
4. **Utilise** `/main-prompt` dans Copilot Chat pour démarrer avec le prompt optimisé
5. **Mets à jour** `memory/session-context.md` à chaque session de travail
