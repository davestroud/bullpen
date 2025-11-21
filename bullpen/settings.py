from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    """
    Centralized configuration for the Bullpen service.

    Environment variables:
    - ``BULLPEN_DATA``: override path to the relievers CSV.
    - ``OPENAI_API_KEY``: enable LLM explanations when set.
    - ``LLM_MODEL``: override the chat model used for explanations.
    """

    project_root: Path = Path(__file__).resolve().parents[1]
    default_data_path: Path = project_root / "data" / "relievers.csv"

    data_path: Path = Path(os.environ.get("BULLPEN_DATA", default_data_path))
    openai_api_key: str | None = os.environ.get("OPENAI_API_KEY")
    llm_model: str = os.environ.get("LLM_MODEL", "gpt-4o-mini")

    explanation_min_words: int = 80
    explanation_max_words: int = 120


settings = Settings()
