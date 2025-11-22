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


def generate_matchup_analysis(
    batter_handedness: str,
    current_pitcher: Dict[str, Any],
    available_relievers: List[Dict[str, Any]],
    game_state: Dict[str, Any],
) -> Optional[str]:
    """Generate matchup analysis from a specialized matchup agent."""
    if not settings.openai_api_key:
        return None

    client = OpenAI(api_key=settings.openai_api_key)
    prompt = (
        "You are a MLB matchup specialist analyzing batter-pitcher platoon advantages. "
        "Evaluate the platoon matchup (L vs R, R vs L) and recommend optimal reliever choices. "
        "Consider: pitcher handedness vs batter, wOBA splits, recent form, and game situation. "
        "Be specific about which reliever matches best. Keep it under 60 words. "
        "Format as: 'Matchup Analysis: [recommendation]'"
    )

    # Find best platoon matchups
    batter_is_lefty = batter_handedness.upper() == "L"
    optimal_handedness = "R" if batter_is_lefty else "L"
    
    platoon_relievers = [
        r for r in available_relievers[:5]
        if r.get("throws", "").upper() == optimal_handedness
    ]

    content = {
        "batter": {
            "handedness": batter_handedness,
            "optimal_pitcher_handedness": optimal_handedness,
        },
        "current_pitcher": {
            "name": current_pitcher.get("name"),
            "throws": current_pitcher.get("throws"),
            "vs_left_woba": current_pitcher.get("vsL_woba", 0.0),
            "vs_right_woba": current_pitcher.get("vsR_woba", 0.0),
        },
        "platoon_advantage": (
            "favorable" if current_pitcher.get("throws", "").upper() == optimal_handedness
            else "unfavorable"
        ),
        "optimal_relievers": [
            {
                "name": r.get("name"),
                "throws": r.get("throws"),
                "vs_left_woba": r.get("vsL_woba", 0.0) if batter_is_lefty else None,
                "vs_right_woba": r.get("vsR_woba", 0.0) if not batter_is_lefty else None,
                "era": r.get("era"),
                "score": r.get("score", 0),
            }
            for r in platoon_relievers[:3]
        ],
        "game_situation": {
            "inning": game_state.get("inning"),
            "outs": game_state.get("outs"),
            "runners": game_state.get("runners", {}),
        },
    }

    try:
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
    except Exception:
        return None


def generate_situational_strategy(
    game_state: Dict[str, Any],
    available_relievers: List[Dict[str, Any]],
) -> Optional[str]:
    """Generate situational strategy recommendations from a strategy specialist agent."""
    if not settings.openai_api_key:
        return None

    client = OpenAI(api_key=settings.openai_api_key)
    prompt = (
        "You are a MLB strategy specialist providing situation-specific bullpen recommendations. "
        "Analyze the game context (save situation, hold situation, high leverage, etc.) "
        "and recommend the optimal reliever type and approach. "
        "Consider: closer vs setup vs middle relief, strikeout ability, ground ball rate, rest. "
        "Be decisive and tactical. Keep it under 70 words. "
        "Format as: 'Situational Strategy: [recommendation]'"
    )

    inning = game_state.get("inning", 1)
    half = game_state.get("half", "Top")
    outs = game_state.get("outs", 0)
    score = game_state.get("score", {})
    runners = game_state.get("runners", {})
    
    # Determine situation type
    score_diff = score.get("away", 0) - score.get("home", 0)
    is_save_situation = (
        half == "Bottom" and 
        inning >= 9 and 
        score_diff <= 3 and 
        score_diff > 0
    )
    is_hold_situation = (
        half == "Top" and 
        inning >= 7 and 
        score_diff > 0 and 
        score_diff <= 3
    )
    is_high_leverage = (
        inning >= 7 and 
        abs(score_diff) <= 2 and
        (runners.get("second") or runners.get("third"))
    )
    
    situation_type = (
        "save" if is_save_situation
        else "hold" if is_hold_situation
        else "high_leverage" if is_high_leverage
        else "medium_leverage" if inning >= 6
        else "low_leverage"
    )

    content = {
        "situation": {
            "type": situation_type,
            "inning": inning,
            "half": half,
            "outs": outs,
            "score_diff": score_diff,
            "runners_on": sum([runners.get("first", False), runners.get("second", False), runners.get("third", False)]),
        },
        "available_relievers": [
            {
                "name": r.get("name"),
                "era": r.get("era"),
                "whip": r.get("whip"),
                "k9": r.get("k9"),
                "days_rest": r.get("days_rest", 0),
                "score": r.get("score", 0),
            }
            for r in available_relievers[:5]
        ],
    }

    try:
        response = client.chat.completions.create(
            model=settings.llm_model,
            temperature=0.25,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": str(content)},
            ],
        )
        message = response.choices[0].message.content
        return message.strip() if message else None
    except Exception:
        return None


def generate_injury_risk_assessment(
    current_pitcher: Dict[str, Any],
    recent_performance: Dict[str, Any],
    usage_history: Dict[str, Any],
) -> Optional[str]:
    """Generate injury risk assessment from a sports medicine specialist agent."""
    if not settings.openai_api_key:
        return None

    client = OpenAI(api_key=settings.openai_api_key)
    prompt = (
        "You are a sports medicine specialist assessing pitcher injury risk. "
        "Analyze workload, fatigue indicators, and usage patterns. "
        "Provide risk assessment and recommendations for pitcher health. "
        "Consider: pitch count, consecutive days, velocity drop indicators, mechanics concerns. "
        "Be clear about risk level (low/medium/high) and specific concerns. Keep it under 65 words. "
        "Format as: 'Injury Risk Assessment: [risk level] - [recommendation]'"
    )

    total_pitches = recent_performance.get("pitches", 0)
    consecutive_days = usage_history.get("consecutive_days", 0)
    days_rest = current_pitcher.get("days_rest", 0)
    
    # Calculate risk factors
    pitch_count_risk = (
        "high" if total_pitches > 40
        else "medium" if total_pitches > 25
        else "low"
    )
    
    rest_risk = (
        "high" if days_rest == 0 and consecutive_days >= 2
        else "medium" if days_rest == 0
        else "low"
    )
    
    fatigue_risk = (
        "high" if recent_performance.get("walks", 0) >= 3 or recent_performance.get("hits", 0) >= 5
        else "medium" if recent_performance.get("walks", 0) >= 2 or recent_performance.get("hits", 0) >= 3
        else "low"
    )

    overall_risk = (
        "high" if pitch_count_risk == "high" or rest_risk == "high" or fatigue_risk == "high"
        else "medium" if pitch_count_risk == "medium" or rest_risk == "medium" or fatigue_risk == "medium"
        else "low"
    )

    content = {
        "pitcher": {
            "name": current_pitcher.get("name"),
            "days_rest": days_rest,
        },
        "workload": {
            "total_pitches": total_pitches,
            "consecutive_days": consecutive_days,
            "recent_walks": recent_performance.get("walks", 0),
            "recent_hits": recent_performance.get("hits", 0),
        },
        "risk_factors": {
            "pitch_count_risk": pitch_count_risk,
            "rest_risk": rest_risk,
            "fatigue_risk": fatigue_risk,
            "overall_risk": overall_risk,
        },
    }

    try:
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
    except Exception:
        return None
