"""
generate_synthetic_prospects.py
================================
Génère un dataset synthétique RÉALISTE de prospects français, pensé pour
l'analyse exploratoire (EDA) du scoring déterministe de `lib/agent/scoring.ts`.

Objectifs de réalisme :
  - Distribution de tailles d'entreprises FR plausible : très long-tail,
    dominée par les PME, très peu de grands comptes / ETI / CAC40.
  - États BEGES cohérents avec l'effectif (l'obligation L.229-25 ne se
    déclenche qu'au-delà de 500 salariés ; on modélise aussi le décret 2022-982).
  - Secteurs NAF (sections) avec une répartition proche de la démographie
    d'entreprises française.
  - Disponibilité du contact (téléphone / email / LinkedIn / rien) en cascade,
    avec un taux d'enrichissement réaliste (le téléphone direct est rare).

Graine fixe (RANDOM_SEED) pour la reproductibilité.

Sortie : analysis/data/synthetic_prospects.csv
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

RANDOM_SEED = 42
N_PROSPECTS = 5000

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
OUT_CSV = DATA_DIR / "synthetic_prospects.csv"

# Seuil réglementaire BEGES (Art. L229-25) : obligation à partir de 500 salariés
# (entreprises privées). On modélise aussi la zone d'anticipation 400-499.
SEUIL_OBLIGATION = 500

# Sections NAF (lettre INSEE) avec poids ~démographie d'entreprises FR.
# (Approximation : commerce/construction/services aux entreprises dominent ;
#  industrie et transport moins nombreux mais surreprésentés au-dessus de 500 sal.)
NAF_SECTIONS = {
    "G": ("Commerce, réparation auto", 0.22),   # commerce de gros/détail
    "F": ("Construction", 0.14),
    "M": ("Activités spé. scientifiques/techniques", 0.13),
    "S": ("Autres services", 0.10),
    "C": ("Industrie manufacturière", 0.09),
    "N": ("Services administratifs et soutien", 0.08),
    "I": ("Hébergement et restauration", 0.07),
    "H": ("Transports et entreposage", 0.05),
    "Q": ("Santé humaine et action sociale", 0.05),
    "J": ("Information et communication", 0.04),
    "K": ("Activités financières et assurance", 0.03),
}

# Sections "intensives carbone" : surpondérées dans les grandes tailles
# (industrie, transport, construction) — cible commerciale prioritaire bilan carbone.
NAF_CARBON_INTENSIVE = {"C", "H", "F"}


# ---------------------------------------------------------------------------
# Distribution de tailles (effectif)
# ---------------------------------------------------------------------------

def _sample_effectifs(rng: np.random.Generator, n: int) -> np.ndarray:
    """
    Effectif salarié plausible pour la France.

    On échantillonne sur une échelle log-normale fortement asymétrique :
    l'écrasante majorité des entreprises emploient < 50 salariés, et la queue
    s'étire jusqu'à plusieurs dizaines de milliers (CAC40). On borne à [1, 60000].

    Le scoring ne s'intéressant qu'aux entreprises >= 250 environ, on MIXE
    deux populations pour garantir un échantillon exploitable autour des seuils
    réglementaires (250-5000) tout en conservant un fond de PME réaliste :
      - 70 % : population générale (long-tail PME)
      - 30 % : population "cible" recentrée autour du seuil BEGES (250-3000)
    """
    n_general = int(n * 0.70)
    n_cible = n - n_general

    # Population générale : log-normale, médiane ~12 salariés.
    general = rng.lognormal(mean=np.log(12), sigma=1.6, size=n_general)

    # Population cible : log-normale recentrée vers ~600 salariés (autour du seuil).
    cible = rng.lognormal(mean=np.log(600), sigma=0.8, size=n_cible)

    effectifs = np.concatenate([general, cible])
    rng.shuffle(effectifs)
    effectifs = np.clip(np.round(effectifs), 1, 60_000).astype(int)
    return effectifs


def _effectif_bornes(rng: np.random.Generator, effectif: int) -> tuple[int, int]:
    """
    Sirene renvoie des tranches d'effectif (pas une valeur exacte).
    On reconstitue effectif_min / effectif_max à partir des tranches INSEE
    standard, en plaçant `effectif` dans la bonne tranche.
    """
    # Bornes des tranches INSEE (effectif salarié).
    tranches = [
        (0, 0), (1, 2), (3, 5), (6, 9), (10, 19), (20, 49),
        (50, 99), (100, 199), (200, 249), (250, 499),
        (500, 999), (1000, 1999), (2000, 4999), (5000, 9999),
        (10000, 60000),
    ]
    for lo, hi in tranches:
        if lo <= effectif <= hi:
            return lo, hi
    return effectif, effectif


# ---------------------------------------------------------------------------
# États BEGES
# ---------------------------------------------------------------------------

def _beges_state(
    rng: np.random.Generator, effectif_max: int
) -> tuple[bool, bool, bool | None, bool | None]:
    """
    Modélise l'état BEGES en cohérence avec l'effectif.

    Retourne (obligation_beges, beges_publie, beges_valide, decret_2022_compliant).

    Hypothèses réalistes (terrain bilan carbone) :
      - obligation déclenchée seulement si effectif_max >= 500.
      - parmi les obligées, ~45 % n'ont JAMAIS publié (infraction L229-25) —
        le taux de non-conformité réel est notoirement élevé.
      - parmi celles qui ont publié, ~35 % ont un bilan expiré (>4 ans).
      - parmi les bilans publiés ET valides, ~40 % sont non conformes au
        Décret 2022-982 (scope 3 ou plan d'action absent).
      - non obligées : pas de bilan (sauf volontariat marginal, ignoré ici).
    """
    obligation = effectif_max >= SEUIL_OBLIGATION

    if not obligation:
        # Pas d'obligation → pas de bilan modélisé.
        return False, False, None, None

    # Obligée : a-t-elle publié ?
    publie = rng.random() > 0.45  # 55 % ont publié

    if not publie:
        # Infraction franche.
        return True, False, None, None

    # Publié : encore valide (< 4 ans) ?
    valide = rng.random() > 0.35  # 65 % valides

    if not valide:
        # Bilan expiré.
        return True, True, False, None

    # Publié et valide : conforme au Décret 2022-982 ?
    compliant = rng.random() > 0.40  # 60 % conformes
    return True, True, True, compliant


# ---------------------------------------------------------------------------
# Contact
# ---------------------------------------------------------------------------

def _contact_state(rng: np.random.Generator) -> tuple[bool, bool, bool]:
    """
    Disponibilité du contact après cascade d'enrichissement
    (Recherche Entreprises → Pappers → Hunter.io).

    Taux réalistes : le téléphone direct est le plus dur à obtenir, l'email
    est intermédiaire, LinkedIn est le fallback le plus fréquent. ~15 % des
    prospects restent sans aucun canal.

    Retourne (has_phone, has_email, has_linkedin) — indépendants, mais le
    scoring ne retient que le canal le plus chaud (cf. _scoreContact).
    """
    has_phone = rng.random() < 0.30
    has_email = rng.random() < 0.55
    has_linkedin = rng.random() < 0.65
    return has_phone, has_email, has_linkedin


def _sample_naf(rng: np.random.Generator, effectif_max: int) -> str:
    """Tire une section NAF, en surpondérant l'industrie/transport pour les grandes tailles."""
    sections = list(NAF_SECTIONS.keys())
    weights = np.array([NAF_SECTIONS[s][1] for s in sections], dtype=float)

    if effectif_max >= SEUIL_OBLIGATION:
        # Au-dessus du seuil, on booste les secteurs carbone-intensifs (cible).
        for i, s in enumerate(sections):
            if s in NAF_CARBON_INTENSIVE:
                weights[i] *= 2.0

    weights /= weights.sum()
    return rng.choice(sections, p=weights)


# ---------------------------------------------------------------------------
# Génération principale
# ---------------------------------------------------------------------------

def generate(n: int = N_PROSPECTS, seed: int = RANDOM_SEED) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    effectifs = _sample_effectifs(rng, n)

    rows = []
    for i, eff in enumerate(effectifs):
        eff_min, eff_max = _effectif_bornes(rng, int(eff))
        obligation, publie, valide, compliant = _beges_state(rng, eff_max)
        has_phone, has_email, has_linkedin = _contact_state(rng)
        naf = _sample_naf(rng, eff_max)

        rows.append(
            {
                "siren": f"{100000000 + i}",
                "raison_sociale": f"Entreprise {i:05d} SAS",
                "secteur_naf": naf,
                "secteur_libelle": NAF_SECTIONS[naf][0],
                "effectif_estime": int(eff),
                "effectif_min": eff_min,
                "effectif_max": eff_max,
                "obligation_beges": obligation,
                "beges_publie": publie,
                # beges_valide / compliant peuvent être None (non applicable).
                "beges_valide": valide,
                "beges_decret_2022_compliant": compliant,
                "contact_telephone": has_phone,
                "contact_email": has_email,
                "contact_linkedin": has_linkedin,
                # Statut CRM : la grande majorité fraîchement sourcée.
                "statut": rng.choice(
                    ["sourced", "qualified", "contacted", "rejected"],
                    p=[0.78, 0.12, 0.07, 0.03],
                ),
            }
        )

    return pd.DataFrame(rows)


def main() -> None:
    try:
        import sys
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    os.makedirs(DATA_DIR, exist_ok=True)
    df = generate()
    df.to_csv(OUT_CSV, index=False)

    # Résumé console (utile en CI / exécution manuelle).
    print(f"[ok] {len(df)} prospects générés (seed={RANDOM_SEED}) -> {OUT_CSV}")
    print("\nDistribution effectif (effectif_max) :")
    print(df["effectif_max"].describe().round(1).to_string())
    n_oblig = int(df["obligation_beges"].sum())
    print(f"\nObligation BEGES (effectif_max >= {SEUIL_OBLIGATION}) : "
          f"{n_oblig} ({100 * n_oblig / len(df):.1f}%)")
    print("\nRépartition sections NAF :")
    print(df["secteur_naf"].value_counts().to_string())
    print("\nContact (au moins un canal) : "
          f"{100 * (df[['contact_telephone','contact_email','contact_linkedin']].any(axis=1)).mean():.1f}%")


if __name__ == "__main__":
    main()
