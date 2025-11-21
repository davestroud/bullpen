from __future__ import annotations

from typing import Iterable, List, Literal, Tuple

from .models import Reliever

LeverageLevel = Literal["low", "medium", "high"]
BatterSide = Literal["L", "R"]


def _platoon_advantage(reliever: Reliever, batter: BatterSide) -> float:
    woba = reliever.vs_left_woba if batter == "L" else reliever.vs_right_woba
    # Normalize wOBA to [0,1]; lower wOBA is better for pitcher.
    return max(0.0, min(1.0, (0.450 - woba) / 0.450))


def score_reliever(
    reliever: Reliever, batter: BatterSide, leverage: LeverageLevel
) -> float:
    # Base weights tuned for transparency; sum to 1.0
    weights = {
        "era": 0.30,
        "whip": 0.25,
        "kbb": 0.20,
        "platoon": 0.20,
        "rest": 0.05,
    }

    if leverage == "high":
        weights["platoon"] += 0.05
        weights["whip"] += 0.05
        weights["kbb"] -= 0.05
    elif leverage == "low":
        weights["platoon"] -= 0.05
        weights["kbb"] += 0.05

    era_term = max(0.0, min(1.0, 3.5 / max(0.01, reliever.era)))
    whip_term = max(0.0, min(1.0, 1.3 / max(0.01, reliever.whip)))
    kbb_term = max(0.0, min(1.0, (reliever.k_per_9 - reliever.bb_per_9 + 5) / 15))
    platoon_term = _platoon_advantage(reliever, batter)
    rest_term = 0.0 if reliever.days_rest >= 1 else -0.5

    return round(
        weights["era"] * era_term
        + weights["whip"] * whip_term
        + weights["kbb"] * kbb_term
        + weights["platoon"] * platoon_term
        + weights["rest"] * rest_term,
        4,
    )


def rank_relievers(
    relievers: Iterable[Reliever],
    batter: BatterSide,
    leverage: LeverageLevel,
    exclude: Iterable[str],
) -> Tuple[List[Reliever], List[Tuple[Reliever, float]]]:
    excluded = {name.strip().lower() for name in exclude}
    candidates = [
        reliever for reliever in relievers if reliever.name.lower() not in excluded
    ]
    scored = [
        (reliever, score_reliever(reliever, batter=batter, leverage=leverage))
        for reliever in candidates
    ]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    top_pairs = scored[:3]
    return [pair[0] for pair in top_pairs], top_pairs
