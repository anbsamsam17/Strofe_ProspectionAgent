"""
Configuration settings for the Prospection Agent.
Loads environment variables from a .env file if present.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# OpenAI
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o")

# Agent behaviour
MAX_PROSPECTS: int = int(os.getenv("MAX_PROSPECTS", "10"))
LANGUAGE: str = os.getenv("LANGUAGE", "fr")
