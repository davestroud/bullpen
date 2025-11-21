from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path
from typing import List

from .models import Reliever


class DataLoadError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def load_relievers(data_path: Path) -> List[Reliever]:
    if not data_path.exists():
        raise DataLoadError(f"Reliever data not found at {data_path}")

    relievers: List[Reliever] = []
    with data_path.open(newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            relievers.append(Reliever.from_row(row))
    if not relievers:
        raise DataLoadError(f"No relievers were loaded from {data_path}")
    return relievers
