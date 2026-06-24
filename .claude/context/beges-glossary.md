# BEGES & réglementation — glossaire métier

## BEGES

**Bilan d'Émissions de Gaz à Effet de Serre** — état chiffré des émissions directes (scope 1) et indirectes liées à l'énergie (scope 2) d'une organisation, sur une année de référence. Cadré par l'**article L229-25 du Code de l'environnement** et le décret 2011-829.

### Seuils d'obligation (cible commerciale principale)

| Catégorie | Seuil |
|-----------|-------|
| Entreprises (France métropolitaine) | **> 500 salariés** |
| Entreprises (DOM) | > 250 salariés |
| Personnes morales de droit public | > 250 agents |
| Collectivités | > 50 000 habitants |

### Validité

**4 ans**. Un BEGES de 2020 doit être renouvelé avant fin 2024. Beaucoup d'entreprises sont en retard ou expirées en 2025-2026 — c'est le levier principal du produit.

### Sanction

Amende administrative jusqu'à **50 000 €** par BEGES manquant ou non publié (montant porté de 10 000 € par la loi Industrie verte de 2023), **100 000 € en cas de récidive**. Argument à manier en appui, pas en ouverture (cf. `prompts-guide.md`).

### Plateforme de publication

**ADEME** : https://bilans-ges.ademe.fr (consultation) et `data.ademe.fr` (API ouverte) — autorité collectrice. Le statut "publié" / "non publié" du prospect est lu depuis cette source.

## Logique de filtre dans le pipeline

Au scoring déterministe et au travail du pipeline commercial, on privilégie :
- `beges_publie = false` (jamais publié) — cible principale (+20 pts au scoring)
- OU `beges_valide = false` (publié mais > 4 ans) — cible renouvellement (+15 pts au scoring)

Les prospects "à jour" (`beges_publie=true` ET `beges_valide=true`) sont dépriorisés — peu pertinents commercialement.

## NAF prioritaires & rationale

Codes par défaut dans `orchestrator.ts NAF_PRIORITAIRES_DEFAULT` (utilisés si les settings user ne contiennent pas de NAF valides) :

| Famille | Codes | Pourquoi |
|---------|-------|----------|
| **Viticulture / négoce** | 01.21Z, 01.22Z | Bassin bordelais ; sensibilité climat dirigée (millésimes), pression export RSE |
| **Aéronautique** | 30.30Z | 2ème pôle FR (Bordeaux Métropole) ; donneurs d'ordre (Airbus, Dassault) imposent carbone |
| **Logistique / entreposage** | 52.10B, 52.29A | Émissions scope 1 lourdes ; économies carburant chiffrables |
| **Transport routier** | 49.41A, 49.41B, 52.21Z | Idem |
| **Agro-alimentaire** | 10.11Z, 10.13A, 10.32Z, 10.51A, 10.71A | Distribution GMS impose le bilan carbone fournisseurs |
| **Commerce intermédiaire agro** | 46.17B | Même chaîne de valeur |
| Industries chimiques (étendu) | 20.11Z, 20.14Z, 20.15Z | Émetteurs majeurs |
| Verre, sidérurgie, métaux (étendu) | 23.11Z, 23.13Z, 24.10Z, 24.20Z, 25.11Z, 25.29Z | Idem |
| Production électricité, déchets, BTP (étendu) | 35.11Z, 38.11Z, 41.20A, 42.11Z, etc. | Idem |
| Hôtellerie / restauration / santé (étendu) | 55.10Z, 56.10A, 86.10Z | Marque + obligations LCT |

Sous-ensemble strict (NAF_PRIORITAIRES dans `scoring.ts`) utilisé pour le bonus +20 pts du scoring : viticulture + aéronautique + logistique + agro-alimentaire + transport. Les codes "étendus" sont sourcés mais n'ouvrent pas droit au bonus secteur.

## Personae cibles (`contact_type` enum)

L'angle des raisons d'appel produites par le scoring commercial Gemini s'adapte au persona recommandé pour chaque prospect.

| Persona | Code DB | Levier dominant |
|---------|---------|------------------|
| **Responsable / Directeur RSE** | `rse` | Impact, cohérence engagements, reporting CSRD, image de marque. Souvent porteur du projet. |
| **DAF** (Directeur Admin & Financier) | `daf` | ROI, économies opérationnelles (10-30%), accès financements (BPI, ADEME, FEDER), risque d'amende. |
| **DRH** (Directeur RH) | `drh` | Marque employeur (attractivité, rétention talents), engagement collaborateurs. |
| **DG / PDG** | `dg` | Compétitivité, appels d'offres avec critères RSE, risque réglementaire et réputationnel. |

Ordre de priorité de ciblage par défaut : RSE → DAF → DRH → DG (cf. `lib/agent/gemini-scoring.ts` `SYSTEM_PROMPT`).

## Termes connexes

- **ROPE** (Recensement des Obligés à la Publication d'un BEGES Émissions) : registre ADEME des entités assujetties.
- **CSRD** (Corporate Sustainability Reporting Directive) : directive européenne 2022/2464, étend l'obligation de reporting à plus d'entreprises (vagues 2024-2026). Le BEGES alimente le pilier environnement.
- **Bilan Carbone®** : méthode ADEME / ABC (Association Bilan Carbone). Le BEGES réglementaire est compatible mais plus restreint (scope 1+2 obligatoire, scope 3 optionnel jusqu'à récemment).
- **Scope 1 / 2 / 3** : émissions directes (combustion sur site) / indirectes énergie (électricité achetée) / autres indirectes (achats, transport amont/aval, déchets).
