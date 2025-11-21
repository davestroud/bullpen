from __future__ import annotations

from typing import Any, Dict, List, Optional

from openai import OpenAI

from .settings import settings


def generate_explanation(
    context: Dict[str, Any], top3: List[Dict[str, Any]]
) -> Optional[str]:
    if not settings.openai_api_key:
        return None

    client = OpenAI(api_key=settings.openai_api_key)
    prompt = (
        "You are Bullpen, an MLB bullpen coach assistant. "
        "Write a concise explanation for the top reliever using only the provided context and stats. "
        f"Stay between {settings.explanation_min_words}-{settings.explanation_max_words} words. "
        "Highlight platoon fit, recent form, and rest considerations. "
        "Do not invent data beyond what is provided."
    )

    content = {
        "game_context": context,
        "candidates": top3,
    }

    response = client.chat.completions.create(
        model=settings.llm_model,
        temperature=0.2,
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": str(content)},
        ],
    )
    message = response.choices[0].message.content
    return message.strip() if message else None
