from __future__ import annotations

import csv
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import List

from .models import Reliever
from .statcast import fetch_reliever_frame, season_start_for, write_relievers_csv
from .settings import settings


class DataLoadError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def load_relievers(data_path: Path) -> List[Reliever]:
    candidates = [data_path]
    sample_path = settings.project_root / "sample_data" / "relievers_2024.csv"
    if sample_path not in candidates:
        candidates.append(sample_path)

    last_error: DataLoadError | None = None

    for path in candidates:
        if not path.exists():
            last_error = DataLoadError(f"Reliever data not found at {path}")
            continue

        relievers: List[Reliever] = []
        with path.open(newline="") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                relievers.append(Reliever.from_row(row))
        if relievers:
            return relievers
        last_error = DataLoadError(f"No relievers were loaded from {path}")

    if last_error:
        raise last_error
    raise DataLoadError("No reliever data could be loaded from any configured path")


def refresh_relievers_csv(
    *,
    data_path: Path,
    start_date: date | None = None,
    end_date: date | None = None,
    min_innings: float = 5.0,
) -> int:
    """Fetch Statcast data and rewrite the reliever CSV used by the service."""

    end = end_date or date.today()
    start = start_date or season_start_for(end)

    frame = fetch_reliever_frame(
        start_date=start, end_date=end, min_innings=min_innings
    )
    write_relievers_csv(frame, output_path=data_path)
    load_relievers.cache_clear()
    return len(frame)
