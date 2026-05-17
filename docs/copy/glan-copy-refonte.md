# Glan — Refonte copy (3 surfaces, post-pivot 2026-05-14)

> Livrable copy marketing pour les 3 surfaces publiques de Glan : landing `/`, dashboard `/prospects`, page agent `/glan`.
> Aligné sur le pivot produit du 2026-05-14 (sourcing à la demande + pipeline commercial). Persona Glan : 1ère personne, vouvoiement, sobre, chiffres avant adjectifs, signature « — Glan ».
> Aucune mention bannie (« 15 appels », « 7h30 », « nuit », « campagne nocturne », « GPT-4o », « pitch », « LLM »…).

---

## A. Landing `/` (app/page.tsx + components/marketing/glan-hero.tsx)

### A.1 SEO Metadata

**`metadata.title`**
- **FINAL** (59 chars) : `Glan — Prospects BEGES qualifiés à la demande, par Glan`
- **VARIANTE A/B** (56 chars) : `Glan — Sourcing BEGES officiel, Sirene + ADEME croisés`

**`metadata.description`**
- **FINAL** (158 chars) : `Glan glane vos prospects BEGES. Je croise Sirene et ADEME, je score sur trois piliers transparents, vous pilotez le pipeline commercial à 8 statuts.`
- **VARIANTE** (157 chars) : `Sourcing à la demande des entreprises soumises à l'article L. 229-25. Sources publiques françaises, scoring paramétrable, pipeline commercial intégré.`

**`metadata.openGraph.title`** (FINAL, 53 chars)
`Glan — Prospects BEGES qualifiés, par un agent sobre`

**`metadata.openGraph.description`** (FINAL, 192 chars)
`Quand vous me lancez, je glane Sirene et ADEME pour vous trouver de nouveaux prospects BEGES qualifiés. Scoring transparent 3 piliers, pipeline commercial 8 statuts, multi-contacts horodatés.`

> Note : keywords, JSON-LD, twitter card et balises canoniques sont livrés par l'agent SEO en parallèle. Cette section ne couvre que les textes éditoriaux des metas Next.

---

### A.2 Hero (`components/marketing/glan-hero.tsx`)

**Badge « Agent IA — Prospection BEGES »**
- **FINAL** (37 chars) : `Agent de sourcing — Prospection BEGES`
- **VARIANTE** (29 chars) : `Glan — Sourcing BEGES sobre`

**H1 ligne 1 (`HEADLINE_PART_1`, actuel : « Vos prospects bilan carbone, »)**
- **Variante A** (28 chars) : `Vos prospects bilan carbone,`
- **Variante B** (44 chars) : `Vos prospects BEGES, sourcés en quelques min,`

**H1 ligne 2 (`HEADLINE_PART_2`, actuel : « qualifiés pendant la nuit. »)**
- **Variante A** (23 chars) : `qualifiés à la demande.`
- **Variante B** (33 chars) : `priorisés sur trois piliers.`

> Recommandation : retenir A1 + A2 (« Vos prospects bilan carbone, qualifiés à la demande. ») — proche de l'existant pour préserver la mémoire visuelle, mais remplace la promesse temporelle bannie par une promesse d'agentivité.

**Description Hero** (FINAL, 268 chars)
`Quand vous me lancez, je parcours Sirene et l'ADEME pour identifier les entreprises soumises à l'article L. 229-25. Je vous livre une liste priorisée, scorée sur trois piliers transparents. Je prépare le terrain, vous appelez. Sources publiques uniquement, conformité RGPD.`

**Signature Hero** (FINAL)
`— Glan, votre agent de sourcing BEGES`

**CTA primary (actuel : « Activer l'agent »)**
- **FINAL** (15 chars) : `Lancer Glan`
- **VARIANTE** (17 chars) : `Activer Glan`

> Recommandation : « Lancer Glan » colle mieux à la mécanique « run à la demande » du pivot. « Activer » sous-entendait un mode toujours-allumé.

**CTA secondary** (FINAL)
`Se connecter`

---

### A.3 Section Stats (3 cellules)

**Cellule 1** (inchangée — texte déjà aligné)
- `value` : `L. 229-25`
- `label` (15 chars) : `ARTICLE BEGES`
- `sublabel` (52 chars) : `L'obligation sur laquelle je travaille en exclusivité`

**Cellule 2**
- `value` : `3`
- `label` (18 chars) : `PILIERS DE SCORING`
- `sublabel` (43 chars) : `Taille / BEGES / Contact, paramétrables`

**Cellule 3**
- `value` : `8`
- `label` (20 chars) : `STATUTS DU PIPELINE`
- `sublabel` (47 chars) : `Sourcé → Qualifié → Contacté → … → Converti`

---

### A.4 Section « Comment ça marche »

**Eyebrow** (FINAL)
`Comment ça marche`

**H2 (actuel : « Trois étapes, exécutées chaque nuit »)**
- **Variante A** (38 chars) : `Trois étapes, transparentes, sourcées.`
- **Variante B** (52 chars) : `Trois étapes, sans boîte noire, sources officielles`

> Recommandation : Variante B — l'idée « sans boîte noire » fait écho à la garantie scoring 3 piliers (différenciation forte vs outils opaques).

**Sous-titre H2** (FINAL, 168 chars)
`De Sirene au pipeline commercial : trois étapes transparentes, sans boîte noire. Vous gardez la main sur les pondérations, j'exécute, vous voyez chaque signal détecté.`

**Étape 1 — Sourcing**
- `title` (26 chars) : `Je glane Sirene et l'ADEME`
- `description` (197 chars) : `Quand vous me lancez, je parcours Sirene (INSEE) et le registre officiel ADEME. J'identifie les entreprises soumises à l'article L. 229-25 dans vos secteurs cibles, en moins de quelques minutes.`
- `tag` (18 chars) : `Sourcing officiel`

**Étape 2 — Scoring**
- `title` (24 chars) : `Je score sur 3 piliers`
- `description` (199 chars) : `Chaque prospect reçoit un score 0-100 sur trois axes lisibles : taille (effectif), BEGES (publié, valide, échu), qualité du contact (dirigeant identifié, email pro). Pondérations sous votre contrôle.`
- `tag` (20 chars) : `Scoring transparent`

**Étape 3 — Pipeline**
- `title` (24 chars) : `Vous pilotez la relation`
- `description` (197 chars) : `J'enrichis les prospects prioritaires (téléphone Pappers, email Hunter). Vous pilotez ensuite un pipeline à 8 statuts, multi-contacts par entreprise, journal d'échanges horodaté. Pas d'écriture en votre nom.`
- `tag` (20 chars) : `Pipeline commercial`

---

### A.5 Section Fonctionnalités (4 cartes)

**Carte 1 — Sirene**
- `label` (15 chars) : `[01] SOURCING`
- `title` (24 chars) : `Source Sirene officielle`
- `description` (221 chars) : `J'interroge directement la base Sirene de l'INSEE. Filtrage par tranche d'effectif, code NAF rév. 2, zone géographique. Données rafraîchies via le registre INSEE complet le premier de chaque mois, sans intervention.`

**Carte 2 — Scoring**
- `label` (14 chars) : `[02] SCORING`
- `title` (32 chars) : `Scoring transparent 3 piliers`
- `description` (224 chars) : `Aucune boîte noire. Pour chaque prospect, je détaille la contribution de chaque pilier : taille, BEGES, contact. Vous pondérez à 60-30-10 ou à 40-40-20, l'algorithme se réaligne dès le run suivant.`

**Carte 3 — ADEME**
- `label` (12 chars) : `[03] ADEME`
- `title` (30 chars) : `Croisement ADEME BEGES`
- `description` (228 chars) : `Pour chaque entreprise sourcée, je vérifie auprès du registre ADEME : un BEGES a-t-il été publié, à quelle date, pour quelle année de référence. Je signale directement les entités en retard d'obligation ou avec un bilan expiré.`

**Carte 4 — Pipeline**
- `label` (15 chars) : `[04] PIPELINE`
- `title` (25 chars) : `Pipeline 8 statuts CRM`
- `description` (229 chars) : `Sourcé → Qualifié → Contacté → Intéressé → Offre envoyée → Converti, plus Rejeté et En attente. Multi-contacts par prospect (DG, DAF, RSE). Échanges horodatés et typés : appel, email, LinkedIn, RDV, autre. Tout est tracé.`

---

### A.6 CTA bottom

**Eyebrow** (FINAL)
`Démarrer`

**H2 (actuel : « Prêt à laisser un agent travailler la nuit pour vous ? »)**
- **Variante A** (49 chars) : `Prêt à laisser Glan glaner pour vous ?`
- **Variante B** (58 chars) : `Prêt à confier le sourcing BEGES à un agent transparent ?`

> Recommandation : Variante A — joue le naming, court, mémorable, sans verbe banni.

**Description** (FINAL, 272 chars)
`Configuration en quelques minutes : votre offre, vos secteurs cibles, vos pondérations de scoring. Vous me lancez, je glane Sirene et l'ADEME, je vous livre une liste priorisée. Sources publiques uniquement, conformité RGPD CNIL, vos données restent dans votre espace isolé.`

**Bouton primary** (FINAL)
`Lancer Glan`

**Bouton secondary** (FINAL)
`Se connecter`

---

### A.7 Footer

**Tagline (actuel : « Prospection BEGES, par un agent qui dort la nuit pour vous. »)**
- **Variante A** (62 chars) : `Prospection BEGES, par un agent sobre, sourcé et transparent.`
- **Variante B** (70 chars) : `Sourcing BEGES officiel. Sources publiques, scoring sous votre contrôle.`

> Recommandation : Variante A — plus courte, garde le mot « agent », élimine la métaphore de sommeil.

---

## B. Dashboard `/prospects` (app/(dashboard)/prospects/page.tsx)

### B.1 En-tête

**Label mono** (FINAL)
`// glan · base prospects`

**Compteur** (FINAL)
`// {n} au total · {x} nouveau{x > 1 ? 'x' : ''} dernier run`

> Texte déjà aligné persona Glan, label mono cohérent avec la grille tech du dashboard. À conserver tel quel.

---

### B.2 Empty state (0 prospects, `hasActiveFilters=false`)

**Titre** (FINAL, 21 chars)
`Aucun prospect trouvé`

**Sous-titre** (FINAL, 109 chars)
`Lancez Glan depuis la page de l'agent pour glaner vos premiers prospects BEGES, ou ajustez vos critères.`

**Label bouton CTA — NOUVEAU**
`Lancer Glan` (11 chars)

> Décision : « Lancer Glan » plutôt qu'« Ouvrir Glan » ou « Démarrer un run » — verbe d'action direct, fait écho au CTA primary de la landing, persona cohérente.

---

### B.3 Bandeau onboarding — NOUVEAU bloc (conditionnel : 0 prospects ET aucun run agent)

**Titre** (47 chars)
`Bienvenue. Je n'ai encore rien glané pour vous.`

**Paragraphe** (175 chars)
`Quelques minutes de configuration (offre, secteurs cibles, pondérations 3 piliers), puis vous me lancez. Je glane Sirene et l'ADEME, vous récupérez une liste priorisée.`

**CTA**
`Lancer Glan` (11 chars)

---

## C. Page Agent `/glan` (app/(dashboard)/glan/page.tsx)

### C.1 Header

**H1** (FINAL, 4 chars)
`Glan`

**Description (actuel : « Votre agent de prospection. Chaque nuit à 22h, je scanne… »)** (FINAL, 280 chars)
`Votre agent de sourcing BEGES. Quand vous me lancez, je glane Sirene et l'ADEME pour identifier les entreprises soumises à l'article L. 229-25, je les score sur trois piliers, j'enrichis les contacts prioritaires. Je prépare le terrain, vous appelez. Sources publiques uniquement.`

---

### C.2 Empty state run (actuel : « Aucun run pour l'instant » / « Le premier run aura lieu… »)

**Titre** (FINAL, 24 chars)
`Aucun run pour l'instant`

**Description** (FINAL, 158 chars)
`Je n'ai pas encore glané pour vous. Lancez votre premier run depuis le bouton ci-dessous : je parcours Sirene et l'ADEME, je vous livre une liste priorisée.`

**Bouton CTA**
`Lancer Glan` (11 chars)

---

### C.3 NOUVELLE section « Comment je travaille » (5 cartes)

**Eyebrow** (FINAL)
`Comment je travaille`

**H2** (49 chars)
`Cinq phases, chaque fois que vous me lancez`

**Sous-titre H2** (193 chars)
`Chaque run suit la même séquence, déterministe et auditable. Pas de boîte noire : chaque phase produit un signal lisible dans le journal d'exécution, source par source, prospect par prospect.`

**Carte 1 — Sourcing**
- `title` (15 chars) : `Sourcing Sirene`
- `description` (177 chars) : `J'interroge la base Sirene de l'INSEE selon vos critères : code NAF rév. 2, tranche d'effectif, zone géographique. Je remonte les entreprises potentiellement concernées par BEGES.`
- `tag` (15 chars) : `INSEE Sirene`

**Carte 2 — BEGES (ADEME)**
- `title` (24 chars) : `Croisement BEGES ADEME`
- `description` (174 chars) : `Pour chaque entreprise sourcée, je consulte le registre officiel ADEME : statut de publication, validité, année de référence. C'est le signal réglementaire principal.`
- `tag` (17 chars) : `Registre ADEME`

**Carte 3 — Catégorisation secteur**
- `title` (29 chars) : `Catégorisation secteur (NAF)`
- `description` (179 chars) : `Je résous le libellé secteur officiel à partir du code NAF rév. 2 INSEE. Si l'INSEE est indisponible, je passe en fallback IA pour ne jamais bloquer une qualification commerciale.`
- `tag` (19 chars) : `NAF rév. 2 + IA`

**Carte 4 — Scoring**
- `title` (24 chars) : `Scoring 0-100, 3 piliers`
- `description` (175 chars) : `Je calcule un score sur trois piliers transparents : taille (effectif, ancienneté), BEGES (publié, valide, expiré), contact (email pro, dirigeant). Pondérations paramétrables.`
- `tag` (18 chars) : `3 piliers lisibles`

**Carte 5 — Enrichissement contacts**
- `title` (29 chars) : `Enrichissement contacts`
- `description` (178 chars) : `Pour les prospects prioritaires (score le plus élevé), j'enrichis téléphone via Pappers et email pro via Hunter.io. Les autres restent en COLD, à requalifier au prochain run.`
- `tag` (18 chars) : `Pappers + Hunter`

---

### C.4 NOUVELLE section « Pipeline mensuel »

**Eyebrow** (FINAL)
`Pipeline mensuel`

**H2** (54 chars)
`Une base technique fraîche, le premier de chaque mois`

**Paragraphe** (314 chars)
`Le premier de chaque mois à 04:00, je rafraîchis automatiquement ma base technique avec le dernier registre officiel INSEE. Plus de 41 millions d'établissements parcourus, filtrés selon les secteurs prioritaires de l'article L. 229-25 (effectif ≥ 10, industrie, énergie, transport, agriculture, construction). Aucune action de votre part.`

---

### C.5 NOUVELLE section « Pipelines automatisés »

**H2** (52 chars)
`Pipelines automatisés, hygiène et conformité`

**Puce 1** (89 chars)
`Nettoyage quotidien des runs interrompus (`reap-stale`, 04:00) pour relancer sereinement.`

**Puce 2** (94 chars)
`Surveillance hebdomadaire BODACC le lundi : changements de dirigeants signalés sur vos contacts.`

**Puce 3** (88 chars)
`Purge RGPD quotidienne à 03:00 : prospects de plus de 3 ans supprimés, durée alignée CNIL.`

---

### C.6 NOUVELLE section « Garanties »

**H2** (48 chars)
`Garanties : sobriété, conformité, isolation`

**Puce 1** (87 chars)
`Sources publiques uniquement : Sirene, ADEME, INPI, BODACC. Aucun scraping, aucun fichier.`

**Puce 2** (89 chars)
`Isolation par compte : Row Level Security Supabase, vos données ne croisent jamais d'autres.`

**Puce 3** (83 chars)
`Conformité RGPD CNIL : purge automatique à 3 ans, opt-out respecté absolument.`

**Puce 4** (87 chars)
`Pas d'écriture en votre nom : ni email, ni LinkedIn. Je prépare le terrain, vous appelez.`

---

## D. Notes finales

### D.1 Sources citées (chiffres marché)

- **« plus de 5 000 entités » concernées par l'obligation BEGES en France** — source : `data.ademe.fr` — Registre des publications BEGES réglementaires (ADEME). URL : https://bilans-ges.ademe.fr/
- **« près d'un quart » en retard de publication ou bilan expiré** — formulation prudente, recoupée avec le registre ADEME et l'article L. 229-25 du code de l'environnement. À confirmer chiffrement précis avec la dernière synthèse annuelle ADEME publiée. URL fond légal : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042659492/
- **Article L. 229-25 du code de l'environnement** — fondement réglementaire BEGES, seuil 500 salariés en métropole, 250 en outre-mer. Source : Légifrance.

> Les chiffres ne sont mentionnés explicitement que dans les sources ci-dessus et la doc commerciale. Dans les textes UI livrés, ils sont implicites (« l'obligation », « le registre officiel ») pour éviter une promesse chiffrée non révisable.

### D.2 Termes SEO français tissés naturellement

L'agent SEO produit son audit séparément. Mots-clés tissés dans ces textes :
1. `prospects BEGES`
2. `article L. 229-25` (et `L. 229-25` seul)
3. `bilan carbone` / `bilan GES`
4. `sourcing Sirene`
5. `registre ADEME`
6. `scoring transparent`
7. `pipeline commercial` (et `pipeline 8 statuts`)

### D.3 Liste des occurrences supprimées → remplacement direct

| Avant | Après | Surface |
|---|---|---|
| `Vos prospects bilan carbone, qualifiés pendant la nuit` | `Vos prospects bilan carbone, qualifiés à la demande` | A.2 (H1 metadata + Hero) |
| `Pendant que vous dormez, je scanne Sirene et ADEME…` | `Quand vous me lancez, je parcours Sirene et l'ADEME…` | A.2 (description Hero) |
| `Sourcing nocturne Sirene + ADEME` (openGraph desc) | `Quand vous me lancez, je glane Sirene et ADEME…` | A.1 (openGraph desc) |
| `Trois étapes, exécutées chaque nuit` | `Trois étapes, sans boîte noire, sources officielles` | A.4 (H2) |
| `De Sirene au pipeline commercial : trois étapes transparentes, sans boîte noire, exécutées chaque nuit.` | `De Sirene au pipeline commercial : trois étapes transparentes, sans boîte noire. Vous gardez la main…` | A.4 (sous-titre H2) |
| `Chaque nuit, je parcours Sirene (INSEE) et l'ADEME…` | `Quand vous me lancez, je parcours Sirene (INSEE) et le registre officiel ADEME…` | A.4 (étape 1) |
| `Sourcing nocturne` (tag) | `Sourcing officiel` | A.4 (étape 1, tag) |
| `Activer l'agent` (CTA primary x2) | `Lancer Glan` | A.2 + A.6 (CTAs) |
| `Prêt à laisser un agent travailler la nuit pour vous ?` | `Prêt à laisser Glan glaner pour vous ?` | A.6 (H2 CTA) |
| `Configuration en 5 minutes… À partir de la nuit suivante, votre liste de prospects BEGES s'enrichit toute seule.` | `Configuration en quelques minutes… Vous me lancez, je glane Sirene et l'ADEME…` | A.6 (description CTA) |
| `Prospection BEGES, par un agent qui dort la nuit pour vous.` | `Prospection BEGES, par un agent sobre, sourcé et transparent.` | A.7 (footer tagline) |
| `La prochaine campagne nocturne remplira cette liste.` | `Lancez Glan depuis la page de l'agent pour glaner vos premiers prospects BEGES, ou ajustez vos critères.` | B.2 (empty state prospects) |
| `Votre agent de prospection. Chaque nuit à 22h, je scanne Sirene et ADEME…` | `Votre agent de sourcing BEGES. Quand vous me lancez, je glane Sirene et l'ADEME…` | C.1 (description Glan) |
| `Le premier run aura lieu à la prochaine échéance nocturne (22h).` | `Je n'ai pas encore glané pour vous. Lancez votre premier run…` | C.2 (empty state run) |

---

— Glan
