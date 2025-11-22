from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

from bullpen.statcast import (
    StatcastError,
    fetch_reliever_frame,
    season_start_for,
    write_relievers_csv,
)


def _parse_date(value: str) -> date:
    return date.fromisoformat(value)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch Statcast data with pybaseball and summarize reliever metrics "
            "into data/relievers.csv."
        )
    )
    parser.add_argument(
        "--start-date",
        default=None,
        type=_parse_date,
        help="Inclusive start date (YYYY-MM-DD). Defaults to March 1 of the current year.",
    )
    parser.add_argument(
        "--end-date",
        default=None,
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

    end_date = args.end_date or date.today()
    start_date = args.start_date or season_start_for(end_date)

    print(f"Fetching Statcast data from {start_date} to {end_date}...")
    try:
        frame = fetch_reliever_frame(
            start_date=start_date, end_date=end_date, min_innings=args.min_innings
        )
    except StatcastError as exc:
        print(exc)
        return 1

    output_path: Path = args.output
    write_relievers_csv(frame, output_path=output_path)
    print(f"Wrote {len(frame)} relievers to {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
