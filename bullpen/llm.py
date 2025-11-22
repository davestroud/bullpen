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


def generate_game_commentary(
    play_description: str,
    game_state: Dict[str, Any],
    reliever: Dict[str, Any],
) -> Optional[str]:
    """Generate color commentary for a simulated game play."""
    if not settings.openai_api_key:
        return None

    client = OpenAI(api_key=settings.openai_api_key)
    prompt = (
        "You are a baseball play-by-play announcer providing color commentary. "
        "Write 1-2 sentences of engaging commentary about the play. "
        "Be enthusiastic but concise. Reference the game situation (inning, score, runners, count) naturally. "
        "Keep it under 50 words. Sound like a real baseball broadcaster."
    )

    content = {
        "play": play_description,
        "game_situation": {
            "inning": game_state.get("inning"),
            "half": game_state.get("half"),
            "outs": game_state.get("outs"),
            "count": f"{game_state.get('balls', 0)}-{game_state.get('strikes', 0)}",
            "score": game_state.get("score", {}),
            "runners": game_state.get("runners", {}),
        },
        "pitcher": {
            "name": reliever.get("name"),
            "stats": {
                "era": reliever.get("era"),
                "whip": reliever.get("whip"),
                "k9": reliever.get("k9"),
            },
        },
    }

    try:
        response = client.chat.completions.create(
            model=settings.llm_model,
            temperature=0.7,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": str(content)},
            ],
        )
        message = response.choices[0].message.content
        return message.strip() if message else None
    except Exception:
        return None
