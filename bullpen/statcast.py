from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from typing import Iterable, List

import pandas as pd
from pybaseball import statcast


class StatcastError(RuntimeError):
    """Raised when Statcast-backed reliever data cannot be generated."""


HIT_EVENTS = {
    "single",
    "double",
    "triple",
    "home_run",
    "grand_slam",
    "double_play",
    "triple_play",
    "force_out",
}
WALK_EVENTS = {"walk", "intent_walk", "hit_by_pitch"}
STRIKEOUT_EVENTS = {"strikeout", "strikeout_double_play", "strikeout_triple_play"}


def season_start_for(day: date) -> date:
    """Return March 1 of the provided year as a default Statcast start date."""

    return day.replace(month=3, day=1)


def _calc_runs(row: pd.Series) -> int:
    if pd.isna(row.post_home_score) or pd.isna(row.post_away_score):
        return 0
    if row.inning_topbot == "Top":
        return int(row.post_away_score - row.away_score)
    return int(row.post_home_score - row.home_score)


def _calc_woba(frame: pd.DataFrame) -> float:
    if frame.empty:
        return 0.0
    value = frame["woba_value"].fillna(0).sum()
    denom = frame["woba_denom"].fillna(0).sum()
    if denom <= 0:
        return 0.0
    return round(float(value / denom), 3)


def _days_since_last_appearance(dates: Iterable[date], end_date: date) -> int:
    last_date = max(dates)
    return (end_date - last_date).days


def summarize_relievers(data: pd.DataFrame, *, end_date: date) -> List[dict]:
    """
    Aggregate Statcast play-by-play data into the reliever CSV schema.

    Parameters
    ----------
    data: pd.DataFrame
        Raw Statcast data with columns including pitcher, events, outs_on_play,
        woba_value, woba_denom, stand, p_throws, player_name, game_date, etc.
    end_date: date
        Inclusive end date of the sample window, used for days_rest.
    """

    relievers: List[dict] = []

    grouped = data.groupby("pitcher")
    for _, frame in grouped:
        frame = frame.copy()
        frame["runs_scored"] = frame.apply(_calc_runs, axis=1)

        outs = float(frame["outs_on_play"].fillna(0).sum())
        innings = outs / 3.0 if outs else 0.0

        hits = int(frame["events"].isin(HIT_EVENTS).sum())
        walks = int(frame["events"].isin(WALK_EVENTS).sum())
        strikeouts = int(frame["events"].isin(STRIKEOUT_EVENTS).sum())
        runs = int(frame["runs_scored"].sum())

        era = round((runs * 9.0) / innings, 2) if innings else 0.0
        whip = round((walks + hits) / innings, 3) if innings else 0.0
        k_per_9 = round((strikeouts * 9.0) / innings, 2) if innings else 0.0
        bb_per_9 = round((walks * 9.0) / innings, 2) if innings else 0.0

        vs_left = _calc_woba(frame[frame["stand"] == "L"])
        vs_right = _calc_woba(frame[frame["stand"] == "R"])

        name = frame["player_name"].dropna().mode()
        throws = frame["p_throws"].dropna().mode()

        if name.empty or throws.empty:
            continue

        appearance_dates = pd.to_datetime(frame["game_date"]).dt.date.unique()
        days_rest = _days_since_last_appearance(appearance_dates, end_date=end_date)

        relievers.append(
            {
                "name": str(name.iloc[0]),
                "throws": str(throws.iloc[0]).upper(),
                "era": era,
                "whip": whip,
                "k9": k_per_9,
                "bb9": bb_per_9,
                "vsL_woba": vs_left,
                "vsR_woba": vs_right,
                "days_rest": days_rest,
                "innings_pitched": round(innings, 2),
            }
        )

    return relievers


def fetch_reliever_frame(
    *, start_date: date, end_date: date, min_innings: float = 5.0
) -> pd.DataFrame:
    """
    Fetch Statcast data for the given window and return the filtered reliever frame.
    """

    dataset = statcast(str(start_date), str(end_date))
    if dataset.empty:
        raise StatcastError(
            f"No Statcast data returned between {start_date} and {end_date}."
        )

    relievers = summarize_relievers(dataset, end_date=end_date)

    filtered = [
        r
        for r in relievers
        if r["era"]
        and (r["era"] >= 0)
        and r["days_rest"] >= 0
        and r["innings_pitched"] >= min_innings
    ]

    if not filtered:
        raise StatcastError(
            "No relievers met the filtering criteria for the provided window."
        )

    field_order = [
        "name",
        "throws",
        "era",
        "whip",
        "k9",
        "bb9",
        "vsL_woba",
        "vsR_woba",
        "days_rest",
    ]

    df = pd.DataFrame(filtered, columns=field_order)
    df.sort_values(by=["era", "whip"], inplace=True)
    return df


def write_relievers_csv(frame: pd.DataFrame, output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output_path, index=False)
    return output_path
