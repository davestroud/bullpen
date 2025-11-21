from __future__ import annotations

from dataclasses import dataclass
from typing import Dict


@dataclass(frozen=True)
class Reliever:
    name: str
    throws: str  # "L" or "R"
    era: float
    whip: float
    k_per_9: float
    bb_per_9: float
    vs_left_woba: float
    vs_right_woba: float
    days_rest: int

    @classmethod
    def from_row(cls, row: Dict[str, str]) -> "Reliever":
        return cls(
            name=row["name"],
            throws=row["throws"].strip().upper(),
            era=float(row["era"]),
            whip=float(row["whip"]),
            k_per_9=float(row["k9"]),
            bb_per_9=float(row["bb9"]),
            vs_left_woba=float(row["vsL_woba"]),
            vs_right_woba=float(row["vsR_woba"]),
            days_rest=int(row["days_rest"]),
        )
