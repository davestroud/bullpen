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
    hits: int
    extra_base_hits: int
    home_runs: int
    total_bases: int
    runs_batted_in: int
    walks: int
    balls: int
    strikes: int

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
            hits=int(row.get("hits", 0)),
            extra_base_hits=int(row.get("extra_base_hits", 0)),
            home_runs=int(row.get("home_runs", 0)),
            total_bases=int(row.get("total_bases", 0)),
            runs_batted_in=int(row.get("runs_batted_in", 0)),
            walks=int(row.get("walks", 0)),
            balls=int(row.get("balls", 0)),
            strikes=int(row.get("strikes", 0)),
        )
