from __future__ import annotations

from datetime import date
from typing import List, Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .data import DataLoadError, load_relievers, refresh_relievers_csv
from .llm import generate_explanation
from .models import Reliever
from .scoring import BatterSide, LeverageLevel, rank_relievers
from .statcast import StatcastError, season_start_for
from .settings import settings

app = FastAPI(
    title="Bullpen Service",
    version="0.1.0",
    description=(
        "Ranks relief pitchers deterministically using CSV data and "
        "optionally generates an LLM explanation for the top recommendation."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://localhost:5173",
        "https://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


class RelieverPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    throws: Literal["L", "R"]
    era: float
    whip: float
    k_per_9: float = Field(alias="k9")
    bb_per_9: float = Field(alias="bb9")
    vs_left_woba: float = Field(alias="vsL_woba")
    vs_right_woba: float = Field(alias="vsR_woba")
    days_rest: int
    score: float


class RecommendationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    batter: BatterSide = Field(description="Batter handedness (L or R).")
    leverage: LeverageLevel = Field(default="medium")
    exclude: List[str] = Field(
        default_factory=list, description="Reliever names to skip."
    )

    @field_validator("exclude")
    @classmethod
    def _strip_names(cls, values: List[str]) -> List[str]:
        return [value.strip() for value in values if value.strip()]


class RecommendationResponse(BaseModel):
    deterministic: bool = True
    top_relievers: List[RelieverPayload]
    explanation: Optional[str]
    context: RecommendationRequest


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_date: Optional[date] = Field(
        default=None, description="Inclusive start date (YYYY-MM-DD)."
    )
    end_date: Optional[date] = Field(
        default=None, description="Inclusive end date (YYYY-MM-DD)."
    )
    min_innings: float = Field(
        default=5.0,
        ge=0.0,
        description="Minimum innings pitched to include a reliever.",
    )

    @model_validator(mode="after")
    def _validate_dates(self) -> "RefreshRequest":
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValueError("start_date cannot be after end_date")
        return self


class RefreshResponse(BaseModel):
    rows_written: int
    output_path: str
    start_date: date
    end_date: date
    min_innings: float


def serialize_reliever(reliever: Reliever, score: float) -> RelieverPayload:
    return RelieverPayload(
        name=reliever.name,
        throws=reliever.throws,
        era=reliever.era,
        whip=reliever.whip,
        k9=reliever.k_per_9,
        bb9=reliever.bb_per_9,
        vsL_woba=reliever.vs_left_woba,
        vsR_woba=reliever.vs_right_woba,
        days_rest=reliever.days_rest,
        score=score,
    )


@app.get("/healthz")
def healthcheck() -> dict:
    return {"status": "ok"}


@app.get("/")
def root() -> dict:
    return {
        "message": "Bullpen service is running.",
        "endpoints": {
            "health": "/healthz",
            "recommendations": "/recommendations",
            "refresh_data": "/refresh-data",
            "docs": "/docs",
        },
    }


@app.post("/recommendations", response_model=RecommendationResponse)
def recommend_body(payload: RecommendationRequest) -> RecommendationResponse:
    try:
        relievers = load_relievers(settings.data_path)
    except DataLoadError as exc:
        try:
            refresh_relievers_csv(data_path=settings.data_path)
            relievers = load_relievers(settings.data_path)
        except StatcastError as refresh_exc:
            raise HTTPException(status_code=502, detail=str(refresh_exc)) from refresh_exc
        except Exception as refresh_exc:  # pragma: no cover - safety net
            raise HTTPException(status_code=500, detail=str(refresh_exc)) from refresh_exc

    _, scored_pairs = rank_relievers(
        relievers=relievers,
        batter=payload.batter,
        leverage=payload.leverage,
        exclude=payload.exclude,
    )
    scored_payloads = [
        serialize_reliever(reliever, score) for reliever, score in scored_pairs
    ]

    explanation = None
    if settings.openai_api_key and scored_payloads:
        explanation = generate_explanation(
            context=payload.model_dump(),
            top3=[p.model_dump(by_alias=True) for p in scored_payloads],
        )

    return RecommendationResponse(
        deterministic=True,
        top_relievers=scored_payloads,
        explanation=explanation,
        context=payload,
    )


@app.post("/refresh-data", response_model=RefreshResponse)
def refresh_data(payload: RefreshRequest) -> RefreshResponse:
    today = date.today()
    end_date = payload.end_date or today
    start_date = payload.start_date or season_start_for(end_date)

    try:
        rows_written = refresh_relievers_csv(
            data_path=settings.data_path,
            start_date=start_date,
            end_date=end_date,
            min_innings=payload.min_innings,
        )
    except StatcastError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - safety net
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return RefreshResponse(
        rows_written=rows_written,
        output_path=str(settings.data_path),
        start_date=start_date,
        end_date=end_date,
        min_innings=payload.min_innings,
    )
