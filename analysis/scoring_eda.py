"""
scoring_eda.py
==============
Analyse exploratoire (EDA) du scoring déterministe.

Objectif : justifier (ou questionner) de façon data-driven les SEUILS et POIDS
posés dans `lib/agent/scoring.ts` :
  - seuils de taille : 250 / 450 / 600 / 5000  (ramp / plateau / décroissance / plancher)
  - poids des piliers : taille 30 / BEGES 30 / contact 40
  - sous-scores BEGES (100 / 50 / +30 / +20) et contact (100 / 50 / 25)
  - pénalités hors piliers : déjà contacté -20, rejeté -50

La section "MIROIR DE lib/agent/scoring.ts" ré-implémente FIDÈLEMENT la logique
TS en Python (mêmes constantes, mêmes branches). Toute divergence serait un bug
d'analyse — les constantes sont copiées telles quelles depuis le fichier source.

Figures produites dans analysis/figures/ :
  1. fig_subscores_distribution.png  — distribution des 3 sous-scores
  2. fig_global_score_distribution.png — distribution du score global + priorités
  3. fig_taille_curve.png            — courbe du sous-score taille vs effectif (seuils)
  4. fig_taille_sensitivity.png      — sensibilité aux bornes (variantes de seuils)
  5. fig_size_vs_score.png           — corrélation taille ↔ score global
  6. fig_weights_impact.png          — impact de la pondération sur le mix de scores
  7. fig_weights_priority_shift.png  — bascule de priorité selon les poids
"""

from __future__ import annotations

from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # backend non-interactif (génération PNG en CI/headless)
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
DATA_CSV = HERE / "data" / "synthetic_prospects.csv"
FIG_DIR = HERE / "figures"

# ===========================================================================
# MIROIR DE lib/agent/scoring.ts — constantes copiées telles quelles
# ===========================================================================

# Pondération par défaut (DEFAULT_SCORING_WEIGHTS)
DEFAULT_WEIGHTS = {"taille": 30, "beges": 30, "contact": 40}

# Pilier 1 — Taille
TAILLE_NO_SCORE_MAX = 250
TAILLE_RAMP_END = 450
TAILLE_PLATEAU_END = 600
TAILLE_DECAY_END = 5000
TAILLE_FLOOR_SCORE = 20

# Pilier 2 — BEGES
BEGES_HOT_SCORE = 100
BEGES_ANTICIPATION_SCORE = 50
BEGES_ANTICIPATION_MIN = 400
BEGES_ANTICIPATION_MAX = 500
BEGES_DECRET_2022_BOOST = 30
BEGES_DECRET_2022_NON_COMPLIANT_BONUS = 20

# Pilier 3 — Contact
CONTACT_PHONE_SCORE = 100
CONTACT_EMAIL_SCORE = 50
CONTACT_LINKEDIN_SCORE = 25

# Pénalités
PENALITE_DEJA_CONTACTE = -20
PENALITE_REJETE = -50

# Clamp & priorité
SCORE_MAX = 100
SCORE_MIN = 0
SUBSCORE_MAX = 100
SEUIL_PRIORITE_HAUTE = 60
SEUIL_PRIORITE_MOYENNE = 30


def _coalesce_effectif(eff_max, eff_min) -> int:
    """prospect.effectif_max ?? prospect.effectif_min ?? 0"""
    if pd.notna(eff_max):
        return int(eff_max)
    if pd.notna(eff_min):
        return int(eff_min)
    return 0


def score_taille(eff_max, eff_min,
                 no_score=TAILLE_NO_SCORE_MAX,
                 ramp_end=TAILLE_RAMP_END,
                 plateau_end=TAILLE_PLATEAU_END,
                 decay_end=TAILLE_DECAY_END,
                 floor=TAILLE_FLOOR_SCORE) -> int:
    """Miroir de _scoreTaille (seuils paramétrables pour l'analyse de sensibilité)."""
    effectif = _coalesce_effectif(eff_max, eff_min)

    if effectif < no_score:
        return 0
    if effectif < ramp_end:
        rng = ramp_end - no_score
        return round(((effectif - no_score) / rng) * SUBSCORE_MAX)
    if effectif <= plateau_end:
        return SUBSCORE_MAX
    if effectif < decay_end:
        rng = decay_end - plateau_end
        drop = SUBSCORE_MAX - floor
        ratio = (effectif - plateau_end) / rng
        return round(SUBSCORE_MAX - drop * ratio)
    return floor


def score_beges(obligation, publie, valide, compliant, eff_max, eff_min) -> int:
    """Miroir de _scoreBeges."""
    obligation_beges = obligation is True
    beges_publie = publie is True
    # valide / compliant peuvent être None (NaN) -> on reproduit la sémantique TS :
    #   begesValide === false  /  beges_decret_2022_compliant === false
    decret_non_compliant = (compliant is False) or (
        isinstance(compliant, (int, float, bool)) and compliant == False  # noqa: E712
        and not pd.isna(compliant)
    )

    # Cas 1 : obligé mais non publié → infraction.
    if obligation_beges and not beges_publie:
        return BEGES_HOT_SCORE
    # Cas 2 : publié mais expiré.
    if beges_publie and valide is False:
        return BEGES_HOT_SCORE
    # Cas 3 (GLN-006) : publié, valide, mais non conforme Décret 2022.
    if obligation_beges and beges_publie and decret_non_compliant:
        return min(
            SUBSCORE_MAX,
            BEGES_ANTICIPATION_SCORE + BEGES_DECRET_2022_BOOST
            + BEGES_DECRET_2022_NON_COMPLIANT_BONUS,
        )
    # Cas 4 : anticipation commerciale (proche du seuil sans obligation).
    if not obligation_beges:
        effectif = _coalesce_effectif(eff_max, eff_min)
        if BEGES_ANTICIPATION_MIN <= effectif < BEGES_ANTICIPATION_MAX:
            return BEGES_ANTICIPATION_SCORE
    return 0


def score_contact(has_phone, has_email, has_linkedin) -> int:
    """Miroir de _scoreContact — hiérarchie stricte, pas de cumul."""
    if has_phone:
        return CONTACT_PHONE_SCORE
    if has_email:
        return CONTACT_EMAIL_SCORE
    if has_linkedin:
        return CONTACT_LINKEDIN_SCORE
    return 0


def compose_final(taille, beges, contact, weights, deja_contacte, rejete) -> int:
    """Miroir de _composeFinalScore (+ pénalités hors piliers)."""
    weighted = (taille * weights["taille"]
                + beges * weights["beges"]
                + contact * weights["contact"]) / SCORE_MAX
    deja_pen = PENALITE_DEJA_CONTACTE if deja_contacte else 0
    rej_pen = PENALITE_REJETE if rejete else 0
    raw = round(weighted) + deja_pen + rej_pen
    return max(SCORE_MIN, min(SCORE_MAX, raw))


def priorite(score: int) -> str:
    if score >= SEUIL_PRIORITE_HAUTE:
        return "haute"
    if score >= SEUIL_PRIORITE_MOYENNE:
        return "moyenne"
    return "basse"


# ===========================================================================
# APPLICATION AU DATASET
# ===========================================================================

def _to_bool(v):
    """CSV round-trip : 'True'/'False'/'' -> bool/None."""
    if pd.isna(v):
        return None
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in ("true", "1"):
        return True
    if s in ("false", "0"):
        return False
    return None


def enrich(df: pd.DataFrame, weights: dict | None = None) -> pd.DataFrame:
    weights = weights or DEFAULT_WEIGHTS
    out = df.copy()

    out["s_taille"] = out.apply(
        lambda r: score_taille(r["effectif_max"], r["effectif_min"]), axis=1
    )
    out["s_beges"] = out.apply(
        lambda r: score_beges(
            _to_bool(r["obligation_beges"]),
            _to_bool(r["beges_publie"]),
            _to_bool(r["beges_valide"]),
            _to_bool(r["beges_decret_2022_compliant"]),
            r["effectif_max"], r["effectif_min"],
        ),
        axis=1,
    )
    out["s_contact"] = out.apply(
        lambda r: score_contact(
            _to_bool(r["contact_telephone"]),
            _to_bool(r["contact_email"]),
            _to_bool(r["contact_linkedin"]),
        ),
        axis=1,
    )

    out["deja_contacte"] = ~out["statut"].isin(["sourced", "qualified"])
    out["rejete"] = out["statut"] == "rejected"

    out["score"] = out.apply(
        lambda r: compose_final(
            r["s_taille"], r["s_beges"], r["s_contact"],
            weights, r["deja_contacte"], r["rejete"],
        ),
        axis=1,
    )
    out["priorite"] = out["score"].apply(priorite)
    return out


# ===========================================================================
# FIGURES
# ===========================================================================

def fig_subscores_distribution(df: pd.DataFrame) -> None:
    fig, axes = plt.subplots(1, 3, figsize=(15, 4.5))
    for ax, col, title, color in [
        (axes[0], "s_taille", "Sous-score Taille", "#2563eb"),
        (axes[1], "s_beges", "Sous-score BEGES", "#16a34a"),
        (axes[2], "s_contact", "Sous-score Contact", "#d97706"),
    ]:
        ax.hist(df[col], bins=np.arange(-2.5, 105, 5), color=color, alpha=0.8,
                edgecolor="white")
        ax.set_title(f"{title}\nmoy={df[col].mean():.1f} | med={df[col].median():.0f}")
        ax.set_xlabel("sous-score (0-100)")
        ax.set_ylabel("nb prospects")
    fig.suptitle("Distribution des 3 sous-scores (dataset synthétique)", fontsize=13, y=1.02)
    fig.tight_layout()
    fig.savefig(FIG_DIR / "fig_subscores_distribution.png", dpi=120, bbox_inches="tight")
    plt.close(fig)


def fig_global_score_distribution(df: pd.DataFrame) -> None:
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 4.5))

    ax1.hist(df["score"], bins=np.arange(-2.5, 105, 5), color="#7c3aed",
             alpha=0.85, edgecolor="white")
    for thr, lbl in [(SEUIL_PRIORITE_MOYENNE, "moyenne ≥30"),
                     (SEUIL_PRIORITE_HAUTE, "haute ≥60")]:
        ax1.axvline(thr, color="black", ls="--", lw=1)
        ax1.text(thr + 1, ax1.get_ylim()[1] * 0.9, lbl, fontsize=8, rotation=90, va="top")
    ax1.set_title(f"Score global\nmoy={df['score'].mean():.1f} | med={df['score'].median():.0f}")
    ax1.set_xlabel("score (0-100)")
    ax1.set_ylabel("nb prospects")

    counts = df["priorite"].value_counts().reindex(["haute", "moyenne", "basse"]).fillna(0)
    colors = {"haute": "#dc2626", "moyenne": "#f59e0b", "basse": "#9ca3af"}
    ax2.bar(counts.index, counts.values, color=[colors[k] for k in counts.index])
    total = counts.sum()
    for i, (k, v) in enumerate(counts.items()):
        ax2.text(i, v, f"{int(v)}\n({100*v/total:.0f}%)", ha="center", va="bottom", fontsize=9)
    ax2.set_title("Répartition des priorités")
    ax2.set_ylabel("nb prospects")

    fig.suptitle("Distribution du score global et des priorités", fontsize=13, y=1.02)
    fig.tight_layout()
    fig.savefig(FIG_DIR / "fig_global_score_distribution.png", dpi=120, bbox_inches="tight")
    plt.close(fig)


def fig_taille_curve(df: pd.DataFrame) -> None:
    effs = np.arange(0, 6000, 5)
    scores = [score_taille(e, None) for e in effs]

    fig, ax = plt.subplots(figsize=(11, 5))
    ax.plot(effs, scores, color="#2563eb", lw=2.2, label="sous-score taille")

    for x, lbl in [(TAILLE_NO_SCORE_MAX, "250 (sous-seuil)"),
                   (TAILLE_RAMP_END, "450 (fin ramp)"),
                   (TAILLE_PLATEAU_END, "600 (fin plateau)"),
                   (TAILLE_DECAY_END, "5000 (plancher)")]:
        ax.axvline(x, color="grey", ls="--", lw=1)
        ax.text(x, 103, lbl, rotation=90, fontsize=8, va="bottom", ha="center")

    ax.axhspan(0, 100, alpha=0.0)
    # Densité réelle des effectifs du dataset (cible 0-5000) en sous-jacent.
    ax2 = ax.twinx()
    sub = df[df["effectif_max"] <= 6000]
    ax2.hist(sub["effectif_max"], bins=60, color="#f59e0b", alpha=0.25)
    ax2.set_ylabel("densité prospects (histogramme orange)", color="#b45309")

    ax.set_xlim(0, 6000)
    ax.set_ylim(0, 112)
    ax.set_xlabel("effectif (effectif_max)")
    ax.set_ylabel("sous-score taille (0-100)")
    ax.set_title("Courbe du sous-score Taille vs effectif — seuils 250 / 450 / 600 / 5000")
    ax.legend(loc="center right")
    fig.tight_layout()
    fig.savefig(FIG_DIR / "fig_taille_curve.png", dpi=120, bbox_inches="tight")
    plt.close(fig)


def fig_taille_sensitivity(df: pd.DataFrame) -> None:
    """Variantes de bornes : comment bouge le sous-score taille moyen et la couverture."""
    effs = np.arange(0, 6000, 5)
    variants = {
        "actuel 250/450/600/5000": dict(no_score=250, ramp_end=450, plateau_end=600, decay_end=5000),
        "plateau large 250/450/1000/5000": dict(no_score=250, ramp_end=450, plateau_end=1000, decay_end=5000),
        "entrée tardive 400/500/700/5000": dict(no_score=400, ramp_end=500, plateau_end=700, decay_end=5000),
        "décroissance lente 250/450/600/10000": dict(no_score=250, ramp_end=450, plateau_end=600, decay_end=10000),
    }
    fig, ax = plt.subplots(figsize=(11, 5))
    for label, params in variants.items():
        curve = [score_taille(e, None, **params) for e in effs]
        ax.plot(effs, curve, lw=2, label=label)
    ax.set_xlim(0, 6000)
    ax.set_xlabel("effectif")
    ax.set_ylabel("sous-score taille")
    ax.set_title("Sensibilité du sous-score Taille aux variantes de seuils")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(FIG_DIR / "fig_taille_sensitivity.png", dpi=120, bbox_inches="tight")
    plt.close(fig)


def fig_size_vs_score(df: pd.DataFrame) -> None:
    fig, ax = plt.subplots(figsize=(11, 5))
    sub = df[df["effectif_max"] <= 8000]
    sc = ax.scatter(sub["effectif_max"], sub["score"], c=sub["s_beges"],
                    cmap="viridis", alpha=0.4, s=10)
    ax.set_xlabel("effectif_max")
    ax.set_ylabel("score global")
    ax.set_title("Corrélation taille ↔ score global (couleur = sous-score BEGES)")
    fig.colorbar(sc, ax=ax, label="sous-score BEGES")

    # Corrélation de Spearman (monotone, robuste aux paliers).
    corr = sub[["effectif_max", "score"]].corr(method="spearman").iloc[0, 1]
    ax.text(0.98, 0.05, f"Spearman ρ = {corr:.2f}", transform=ax.transAxes,
            ha="right", fontsize=10, bbox=dict(boxstyle="round", fc="white", alpha=0.8))
    fig.tight_layout()
    fig.savefig(FIG_DIR / "fig_size_vs_score.png", dpi=120, bbox_inches="tight")
    plt.close(fig)


def fig_weights_impact(df: pd.DataFrame) -> dict:
    """Compare la distribution du score sous plusieurs pondérations."""
    scenarios = {
        "défaut 30/30/40": {"taille": 30, "beges": 30, "contact": 40},
        "équilibré 33/33/34": {"taille": 33, "beges": 33, "contact": 34},
        "taille-first 50/25/25": {"taille": 50, "beges": 25, "contact": 25},
        "beges-first 25/50/25": {"taille": 25, "beges": 50, "contact": 25},
        "contact-first 20/20/60": {"taille": 20, "beges": 20, "contact": 60},
    }
    stats = {}
    fig, ax = plt.subplots(figsize=(11, 5))
    for label, w in scenarios.items():
        scored = enrich(df, w)["score"]
        ax.hist(scored, bins=np.arange(-2.5, 105, 5), histtype="step", lw=2, label=label)
        stats[label] = {
            "mean": round(scored.mean(), 1),
            "median": int(scored.median()),
            "pct_haute": round(100 * (scored >= SEUIL_PRIORITE_HAUTE).mean(), 1),
        }
    ax.axvline(SEUIL_PRIORITE_HAUTE, color="black", ls="--", lw=1)
    ax.set_xlabel("score global")
    ax.set_ylabel("nb prospects")
    ax.set_title("Impact de la pondération sur la distribution du score")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(FIG_DIR / "fig_weights_impact.png", dpi=120, bbox_inches="tight")
    plt.close(fig)
    return stats


def fig_weights_priority_shift(df: pd.DataFrame, weight_stats: dict) -> None:
    labels = list(weight_stats.keys())
    pct = [weight_stats[k]["pct_haute"] for k in labels]
    fig, ax = plt.subplots(figsize=(10, 4.5))
    bars = ax.barh(labels, pct, color="#dc2626", alpha=0.8)
    for b, v in zip(bars, pct):
        ax.text(v + 0.3, b.get_y() + b.get_height() / 2, f"{v}%", va="center", fontsize=9)
    ax.set_xlabel("% prospects en priorité HAUTE (score ≥ 60)")
    ax.set_title("Bascule de la priorité HAUTE selon la pondération")
    fig.tight_layout()
    fig.savefig(FIG_DIR / "fig_weights_priority_shift.png", dpi=120, bbox_inches="tight")
    plt.close(fig)


# ===========================================================================
# MAIN
# ===========================================================================

def main() -> None:
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    if not DATA_CSV.exists():
        raise SystemExit(
            f"Dataset introuvable : {DATA_CSV}\n"
            "Lance d'abord : python analysis/generate_synthetic_prospects.py"
        )

    # Force stdout en UTF-8 (Windows console = cp1252 par défaut, casse sur ρ / ↔).
    try:
        import sys
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001 — best effort, n'empêche pas l'analyse.
        pass

    df = pd.read_csv(DATA_CSV)
    scored = enrich(df, DEFAULT_WEIGHTS)

    print("=" * 70)
    print("EDA SCORING — résumé chiffré (pondération défaut 30/30/40)")
    print("=" * 70)
    print(f"\nN prospects : {len(scored)}")
    print("\n— Sous-scores (moyenne / médiane / % == 0) —")
    for col in ["s_taille", "s_beges", "s_contact"]:
        s = scored[col]
        print(f"  {col:10s} : moy={s.mean():5.1f}  med={s.median():3.0f}  "
              f"%zéro={100*(s==0).mean():4.1f}%  %max={100*(s==100).mean():4.1f}%")

    print("\n— Score global —")
    print(f"  moy={scored['score'].mean():.1f}  med={scored['score'].median():.0f}  "
          f"std={scored['score'].std():.1f}")
    pr = scored["priorite"].value_counts(normalize=True) * 100
    print("\n— Priorités —")
    for k in ["haute", "moyenne", "basse"]:
        print(f"  {k:8s} : {pr.get(k, 0):.1f}%")

    # Corrélation taille ↔ score.
    corr = scored[scored["effectif_max"] <= 8000][["effectif_max", "score"]].corr(
        method="spearman").iloc[0, 1]
    print(f"\n— Corrélation Spearman effectif_max ↔ score (≤8000 sal.) : ρ={corr:.2f}")

    # Figures.
    fig_subscores_distribution(scored)
    fig_global_score_distribution(scored)
    fig_taille_curve(scored)
    fig_taille_sensitivity(scored)
    fig_size_vs_score(scored)
    weight_stats = fig_weights_impact(df)
    fig_weights_priority_shift(df, weight_stats)

    print("\n— Impact pondération (moy / médiane / % haute) —")
    for label, s in weight_stats.items():
        print(f"  {label:26s} : moy={s['mean']:5.1f}  med={s['median']:3d}  "
              f"%haute={s['pct_haute']:4.1f}%")

    print(f"\n[ok] 7 figures générées dans {FIG_DIR}")


if __name__ == "__main__":
    main()
