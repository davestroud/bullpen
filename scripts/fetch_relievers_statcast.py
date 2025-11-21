from __future__ import annotations

import argparse
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Iterable, List

import pandas as pd
from pybaseball import statcast


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


def _parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch Statcast data with pybaseball and summarize reliever metrics "
            "into data/relievers.csv."
        )
    )
    parser.add_argument(
        "--start-date",
        default=str(date.today().replace(month=3, day=1)),
        type=_parse_date,
        help="Inclusive start date (YYYY-MM-DD). Defaults to March 1 of the current year.",
    )
    parser.add_argument(
        "--end-date",
        default=str(date.today()),
        type=_parse_date,
        help="Inclusive end date (YYYY-MM-DD). Defaults to today.",
    )
    parser.add_argument(
        "--min-innings",
        default=5.0,
        type=float,
        help="Minimum innings pitched to include a reliever.",
    )
    parser.add_argument(
        "--output",
        default="data/relievers.csv",
        type=Path,
        help="Where to write the summarized CSV (relative to repo root).",
    )

    args = parser.parse_args(argv)

    print(f"Fetching Statcast data from {args.start_date} to {args.end_date}...")
    dataset = statcast(str(args.start_date), str(args.end_date))
    if dataset.empty:
        print("No Statcast data returned for the specified window.")
        return 1

    relievers = summarize_relievers(dataset, end_date=args.end_date)

    filtered = [
        r
        for r in relievers
        if r["era"]
        and (r["era"] >= 0)
        and r["days_rest"] >= 0
        and r["innings_pitched"] >= args.min_innings
    ]

    if not filtered:
        print("No relievers met the filtering criteria.")
        return 1

    output_path: Path = args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
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
    df.to_csv(output_path, index=False)
    print(f"Wrote {len(df)} relievers to {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

