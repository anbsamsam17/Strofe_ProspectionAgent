"""
Core prospection agent for Bilan Carbone.

This module exposes :class:`ProspectionAgent`, which uses an LLM to generate
personalised outreach messages for carbon-footprint (bilan carbone) services.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from openai import OpenAI

from agent.config import OPENAI_API_KEY, OPENAI_MODEL, LANGUAGE, MAX_PROSPECTS


@dataclass
class Prospect:
    """Represents a prospective client."""

    name: str
    company: str
    sector: str
    email: str = ""
    message: str = field(default="", init=False)


class ProspectionAgent:
    """AI agent that generates prospection messages for Bilan Carbone services."""

    SYSTEM_PROMPT = (
        "Tu es un expert en bilan carbone et en prospection commerciale. "
        "Tu rédiges des messages de prospection professionnels, concis et personnalisés "
        "pour proposer des services de bilan carbone aux entreprises."
    )

    def __init__(self) -> None:
        if not OPENAI_API_KEY:
            raise ValueError(
                "La clé OPENAI_API_KEY est manquante. "
                "Vérifiez votre fichier .env ou vos variables d'environnement."
            )
        self._client = OpenAI(api_key=OPENAI_API_KEY)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def generate_message(self, prospect: Prospect) -> str:
        """Generate a personalised prospection message for *prospect*.

        The message is also stored in ``prospect.message`` for convenience.

        Args:
            prospect: The prospect for whom the message is generated.

        Returns:
            The generated message as a plain string.
        """
        user_prompt = self._build_user_prompt(prospect)
        response = self._client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": self.SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.7,
        )
        message = response.choices[0].message.content or ""
        prospect.message = message
        return message

    def process_prospects(self, prospects: List[Prospect]) -> List[Prospect]:
        """Generate messages for a list of prospects.

        Processing is limited to :data:`~agent.config.MAX_PROSPECTS` entries.
        If the API call fails for a given prospect, the error is printed and
        processing continues with the remaining entries.

        Args:
            prospects: List of :class:`Prospect` objects to process.

        Returns:
            The same list (up to ``MAX_PROSPECTS`` entries) with
            ``prospect.message`` populated for each successfully processed entry.
        """
        batch = prospects[:MAX_PROSPECTS]
        for prospect in batch:
            try:
                self.generate_message(prospect)
            except Exception as exc:  # noqa: BLE001
                print(
                    f"[ERREUR] Impossible de générer le message pour "
                    f"{prospect.name} ({prospect.company}) : {exc}"
                )
        return batch

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _build_user_prompt(self, prospect: Prospect) -> str:
        lang_note = "" if LANGUAGE == "fr" else f" Respond in {LANGUAGE}."
        return (
            f"Rédige un message de prospection pour :{lang_note}\n"
            f"- Nom : {prospect.name}\n"
            f"- Entreprise : {prospect.company}\n"
            f"- Secteur : {prospect.sector}\n\n"
            "Le message doit être professionnel, personnalisé et mettre en avant "
            "l'importance du bilan carbone pour leur secteur d'activité."
        )
