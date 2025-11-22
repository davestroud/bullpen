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


def generate_strategic_advice(
    game_state: Dict[str, Any],
    current_pitcher: Dict[str, Any],
    available_relievers: List[Dict[str, Any]],
    recent_performance: Dict[str, Any],
) -> Optional[str]:
    """Generate strategic advice from a bullpen coach agent."""
    if not settings.openai_api_key:
        return None

    client = OpenAI(api_key=settings.openai_api_key)
    prompt = (
        "You are an experienced MLB bullpen coach providing strategic advice. "
        "Analyze the game situation and provide actionable recommendations. "
        "Consider: pitch count/fatigue, game situation (score, inning, leverage), "
        "upcoming batters, reliever availability and rest. "
        "Be decisive and specific. Keep it under 75 words. "
        "Format as clear recommendations (e.g., 'Consider warming up X' or 'Stick with current pitcher')."
    )

    # Calculate fatigue indicators
    total_pitches = recent_performance.get("balls", 0) + recent_performance.get("strikes", 0)
    fatigue_level = "low" if total_pitches < 15 else "medium" if total_pitches < 30 else "high"
    
    # Determine leverage
    score_diff = abs(game_state.get("score", {}).get("away", 0) - game_state.get("score", {}).get("home", 0))
    inning = game_state.get("inning", 1)
    leverage = "high" if (score_diff <= 2 and inning >= 7) else "medium" if (score_diff <= 4) else "low"

    content = {
        "game_situation": {
            "inning": game_state.get("inning"),
            "half": game_state.get("half"),
            "outs": game_state.get("outs"),
            "score": game_state.get("score", {}),
            "runners": game_state.get("runners", {}),
            "leverage": leverage,
        },
        "current_pitcher": {
            "name": current_pitcher.get("name"),
            "stats": {
                "era": current_pitcher.get("era"),
                "whip": current_pitcher.get("whip"),
                "k9": current_pitcher.get("k9"),
            },
            "recent_performance": recent_performance,
            "fatigue_indicators": {
                "total_pitches": total_pitches,
                "fatigue_level": fatigue_level,
                "walks_issued": recent_performance.get("walks", 0),
                "hits_allowed": recent_performance.get("hits", 0),
            },
        },
        "available_relievers": [
            {
                "name": r.get("name"),
                "throws": r.get("throws"),
                "era": r.get("era"),
                "days_rest": r.get("days_rest", 0),
                "score": r.get("score", 0),
            }
            for r in available_relievers[:5]
        ],
    }

    try:
        response = client.chat.completions.create(
            model=settings.llm_model,
            temperature=0.3,  # Lower temperature for more consistent strategic advice
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": str(content)},
            ],
        )
        message = response.choices[0].message.content
        return message.strip() if message else None
    except Exception:
        return None
