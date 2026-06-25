# Analyse exploratoire (EDA) — Scoring déterministe

> Justification **data-driven** des seuils et poids du scoring de prospection
> (`lib/agent/scoring.ts`), aujourd'hui posés à la main sans analyse.

## Objectif

Le scoring déterministe attribue à chaque prospect un score 0-100 à partir de
3 sous-scores pondérés :

| Pilier  | Sous-score | Poids défaut |
|---------|-----------|--------------|
| Taille  | 0-100 (seuils 250 / 450 / 600 / 5000) | **30** |
| BEGES   | 0-100 (infraction 100, anticipation 50, +30/+20 décret 2022) | **30** |
| Contact | téléphone 100 / email 50 / LinkedIn 25 | **40** |

Pénalités hors piliers : déjà contacté **−20**, rejeté **−50**. Seuils de
priorité : haute **≥60**, moyenne **≥30**.

Ces constantes n'avaient jamais été validées. Cette EDA :

1. génère un **dataset synthétique réaliste** (démographie d'entreprises FR),
2. applique un **miroir Python fidèle** de `scoring.ts`,
3. produit des **figures** (distributions, sensibilité aux seuils, impact des
   poids, corrélation taille↔score),
4. **conclut** sur la pertinence des seuils/poids et propose des alternatives.

## Installation

Python 3.11. Depuis la racine du projet :

```bash
pip install -r analysis/requirements.txt
```

(`jupyter` n'est requis que pour ouvrir/réexécuter le notebook ; les scripts
`.py` n'ont besoin que de `pandas`, `numpy`, `matplotlib`.)

## Exécution

```bash
# 1. Générer le dataset synthétique (seed fixe -> reproductible)
python analysis/generate_synthetic_prospects.py
#    -> analysis/data/synthetic_prospects.csv  (5000 prospects)

# 2. Lancer l'EDA : chiffres console + 7 figures PNG
python analysis/scoring_eda.py
#    -> analysis/figures/*.png

# 3. (optionnel) Réexécuter le notebook de présentation
cd analysis && jupyter nbconvert --to notebook --execute --inplace scoring-eda.ipynb
```

> Sous Windows, si la console plante sur un caractère accentué, préfixer avec
> `set PYTHONIOENCODING=utf-8` (les scripts forcent déjà l'UTF-8 sur stdout).

## Fichiers

| Fichier | Rôle |
|---------|------|
| `requirements.txt` | dépendances épinglées |
| `generate_synthetic_prospects.py` | génère le dataset synthétique (seed=42) |
| `scoring_eda.py` | **miroir fidèle** de `scoring.ts` + figures + stats |
| `scoring-eda.ipynb` | notebook narratif (artefact de présentation) |
| `data/synthetic_prospects.csv` | dataset généré |
| `figures/*.png` | 7 figures |

## Résumé des conclusions

1. **Seuils de taille (250/450/600/5000) — justifiés.** Indexés sur le seuil
   légal réel (500 salariés), ils placent le plateau optimal exactement sur la
   cible. Seul raffinement utile : **élargir le plateau jusqu'à ~800-1000** pour
   ne pas pénaliser prématurément les ETI de 600-1000 salariés (qui perdent déjà
   ~5-6 points alors qu'elles restent cibles de premier choix).

2. **Poids 30/30/40 — justifiés et robustes.** Le pilier **Contact (40)** est le
   plus dense (médiane 50, seulement ~12 % à zéro) et le plus actionnable ; son
   poids dominant est validé par la donnée. Les variantes *contact-first* (60 →
   ~35 % de priorité haute) et *taille-first* (50 → ~22 %) dégradent le ciblage.
   Une variante **35/35/30** (ou un boost BEGES sur les `is_hot_lead`) est une
   piste d'amélioration marginale, pas une correction d'erreur.

3. **Taille ↔ score décorrélés (Spearman ρ ≈ 0.55).** Sain : le score ne se
   réduit pas à la taille — BEGES et Contact discriminent réellement à effectif
   égal. C'est l'intérêt même du barème multi-piliers.

4. **Seuils de priorité (60 / 30) — bien placés.** Le seuil haute=60 tombe dans
   un creux de la distribution et produit ~18 % de priorité haute : volume
   opérationnel sain et stable face à de petits déplacements de poids.

**Limite assumée :** dataset *synthétique* — l'EDA valide la **cohérence interne
et la robustesse** du barème, pas son pouvoir prédictif réel. Étape suivante :
rejouer l'analyse sur les `prospects` réels et corréler le score aux `call_result`
pour une calibration empirique.
