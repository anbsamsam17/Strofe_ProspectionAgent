#!/usr/bin/env python3
"""
Entry point for the Agent de Prospection - Bilan Carbone.

Usage
-----
    python main.py

The agent reads a list of sample prospects and generates personalised
outreach messages for each of them.
"""

from agent.prospection_agent import Prospect, ProspectionAgent


SAMPLE_PROSPECTS = [
    Prospect(
        name="Marie Dupont",
        company="Logistique Express",
        sector="Transport et logistique",
        email="m.dupont@logistique-express.fr",
    ),
    Prospect(
        name="Jean Martin",
        company="BTP Constructions",
        sector="Bâtiment et travaux publics",
        email="j.martin@btp-constructions.fr",
    ),
    Prospect(
        name="Sophie Bernard",
        company="Grande Distribution SA",
        sector="Commerce de détail",
        email="s.bernard@grande-distribution.fr",
    ),
]


def main() -> None:
    agent = ProspectionAgent()
    prospects = agent.process_prospects(SAMPLE_PROSPECTS)

    for prospect in prospects:
        print(f"\n{'=' * 60}")
        print(f"Prospect : {prospect.name} ({prospect.company})")
        print(f"Email    : {prospect.email}")
        print(f"Secteur  : {prospect.sector}")
        print(f"\nMessage :\n{prospect.message}")

    print(f"\n{'=' * 60}")
    print(f"\n✅ {len(prospects)} message(s) généré(s) avec succès.")


if __name__ == "__main__":
    main()
