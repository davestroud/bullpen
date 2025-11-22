from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .agents import AgentContext, run_multi_agent_recommendation
from .data import DataLoadError, refresh_relievers_csv
from .llm import (
    generate_game_commentary,
    generate_strategic_advice,
    generate_matchup_analysis,
    generate_situational_strategy,
    generate_injury_risk_assessment,
)
from .models import Reliever
from .scoring import BatterSide, LeverageLevel
from .settings import settings
from .statcast import StatcastError, season_start_for

app = FastAPI(
    title="Bullpen Service",
    version="0.1.0",
    description=(
        "Ranks relief pitchers using a LangGraph multi-agent workflow. "
        "Includes data loading, deterministic scoring, LLM explanation, and critic validation agents. "
        "Features multiple specialist agents: Strategic Decision, Matchup Analysis, "
        "Situational Strategy, and Injury Risk Assessment."
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

    team: str
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
    hits: int
    extra_base_hits: int
    home_runs: int
    total_bases: int
    runs_batted_in: int
    walks: int
    balls: int
    strikes: int


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
    notes: Optional[List[str]] = Field(
        default=None, description="Agent workflow notes and validation feedback."
    )


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
        team=reliever.team,
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
        hits=reliever.hits,
        extra_base_hits=reliever.extra_base_hits,
        home_runs=reliever.home_runs,
        total_bases=reliever.total_bases,
        runs_batted_in=reliever.runs_batted_in,
        walks=reliever.walks,
        balls=reliever.balls,
        strikes=reliever.strikes,
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
            "commentary": "/commentary",
            "strategic_advice": "/strategic-advice",
            "matchup_analysis": "/matchup-analysis",
            "situational_strategy": "/situational-strategy",
            "injury_risk": "/injury-risk",
            "refresh_data": "/refresh-data",
            "docs": "/docs",
        },
    }


@app.post("/recommendations", response_model=RecommendationResponse)
def recommend_body(payload: RecommendationRequest) -> RecommendationResponse:
    """
    Generate reliever recommendations using the LangGraph multi-agent workflow.
    
    The workflow includes:
    - Data loading agent (with auto-refresh fallback)
    - Scoring agent (deterministic ranking)
    - Explanation agent (LLM-generated if API key set)
    - Critic agent (validates explanation quality)
    """
    # Convert request to agent context
    agent_context: AgentContext = {
        "batter": payload.batter,
        "leverage": payload.leverage,
        "exclude": payload.exclude,
    }

    try:
        # Run the multi-agent workflow
        result = run_multi_agent_recommendation(agent_context)
    except StatcastError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except DataLoadError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - safety net
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # Extract scored pairs from agent state
    scored_pairs = result.get("scored", [])
    if not scored_pairs:
        raise HTTPException(
            status_code=500, detail="Agent workflow did not produce any scored relievers."
        )

    # Serialize relievers for response
    scored_payloads = [
        serialize_reliever(reliever, score) for reliever, score in scored_pairs
    ]

    # Extract explanation and notes from agent state
    explanation = result.get("explanation")
    notes = result.get("notes")

    return RecommendationResponse(
        deterministic=True,
        top_relievers=scored_payloads,
        explanation=explanation,
        context=payload,
        notes=notes if notes else None,
    )


class CommentaryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    play_description: str = Field(description="Description of the play that occurred.")
    game_state: Dict[str, Any] = Field(description="Current game state (inning, outs, count, score, runners).")
    reliever: Dict[str, Any] = Field(description="Reliever information (name, stats).")


class CommentaryResponse(BaseModel):
    commentary: Optional[str] = Field(description="LLM-generated commentary about the play.")


@app.post("/commentary", response_model=CommentaryResponse)
def generate_commentary(payload: CommentaryRequest) -> CommentaryResponse:
    """
    Generate LLM commentary for a simulated game play.
    
    Provides color commentary in the style of a baseball broadcaster
    based on the play description and current game situation.
    """
    commentary = None
    if settings.openai_api_key:
        commentary = generate_game_commentary(
            play_description=payload.play_description,
            game_state=payload.game_state,
            reliever=payload.reliever,
        )
    
    return CommentaryResponse(commentary=commentary)


class StrategicAdviceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    game_state: Dict[str, Any] = Field(description="Current game state (inning, outs, score, runners).")
    current_pitcher: Dict[str, Any] = Field(description="Current pitcher information and stats.")
    available_relievers: List[Dict[str, Any]] = Field(description="Available relievers with their stats.")
    recent_performance: Dict[str, Any] = Field(description="Recent performance metrics (pitches, hits, walks).")


class StrategicAdviceResponse(BaseModel):
    advice: Optional[str] = Field(description="Strategic advice from the bullpen coach agent.")
    recommendation: Optional[str] = Field(description="Specific recommendation (e.g., 'pull_pitcher', 'warm_up_X').")


@app.post("/strategic-advice", response_model=StrategicAdviceResponse)
def get_strategic_advice(payload: StrategicAdviceRequest) -> StrategicAdviceResponse:
    """
    Generate strategic advice from the Strategic Decision Agent.
    
    Analyzes game situation, pitcher fatigue, and available relievers
    to provide actionable bullpen management recommendations.
    """
    advice = None
    recommendation = None
    
    if settings.openai_api_key:
        advice = generate_strategic_advice(
            game_state=payload.game_state,
            current_pitcher=payload.current_pitcher,
            available_relievers=payload.available_relievers,
            recent_performance=payload.recent_performance,
        )
        
        # Extract recommendation from advice if possible
        if advice:
            advice_lower = advice.lower()
            if "warm up" in advice_lower or "warm-up" in advice_lower:
                # Try to extract reliever name
                for reliever in payload.available_relievers:
                    if reliever.get("name", "").lower() in advice_lower:
                        recommendation = f"warm_up_{reliever.get('name', '').replace(' ', '_')}"
                        break
            elif "pull" in advice_lower or "remove" in advice_lower or "replace" in advice_lower:
                recommendation = "consider_pulling_pitcher"
            elif "stick" in advice_lower or "keep" in advice_lower or "continue" in advice_lower:
                recommendation = "keep_current_pitcher"
    
    return StrategicAdviceResponse(advice=advice, recommendation=recommendation)


class MatchupAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    batter_handedness: str = Field(description="Batter handedness (L or R).")
    current_pitcher: Dict[str, Any] = Field(description="Current pitcher information and stats.")
    available_relievers: List[Dict[str, Any]] = Field(description="Available relievers with their stats.")
    game_state: Dict[str, Any] = Field(description="Current game state.")


class MatchupAnalysisResponse(BaseModel):
    analysis: Optional[str] = Field(description="Matchup analysis from the specialist agent.")


@app.post("/matchup-analysis", response_model=MatchupAnalysisResponse)
def get_matchup_analysis(payload: MatchupAnalysisRequest) -> MatchupAnalysisResponse:
    """
    Generate matchup analysis from the Matchup Analysis Agent.
    
    Analyzes batter-pitcher platoon advantages and recommends optimal reliever choices
    based on handedness matchups and wOBA splits.
    """
    analysis = None
    
    if settings.openai_api_key:
        analysis = generate_matchup_analysis(
            batter_handedness=payload.batter_handedness,
            current_pitcher=payload.current_pitcher,
            available_relievers=payload.available_relievers,
            game_state=payload.game_state,
        )
    
    return MatchupAnalysisResponse(analysis=analysis)


class SituationalStrategyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    game_state: Dict[str, Any] = Field(description="Current game state (inning, outs, score, runners).")
    available_relievers: List[Dict[str, Any]] = Field(description="Available relievers with their stats.")


class SituationalStrategyResponse(BaseModel):
    strategy: Optional[str] = Field(description="Situational strategy recommendation from the specialist agent.")


@app.post("/situational-strategy", response_model=SituationalStrategyResponse)
def get_situational_strategy(payload: SituationalStrategyRequest) -> SituationalStrategyResponse:
    """
    Generate situational strategy from the Situational Strategy Agent.
    
    Provides context-specific recommendations for save situations, hold situations,
    high leverage moments, and other game contexts.
    """
    strategy = None
    
    if settings.openai_api_key:
        strategy = generate_situational_strategy(
            game_state=payload.game_state,
            available_relievers=payload.available_relievers,
        )
    
    return SituationalStrategyResponse(strategy=strategy)


class InjuryRiskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_pitcher: Dict[str, Any] = Field(description="Current pitcher information.")
    recent_performance: Dict[str, Any] = Field(description="Recent performance metrics (pitches, hits, walks).")
    usage_history: Dict[str, Any] = Field(description="Usage history (consecutive days, etc.).")


class InjuryRiskResponse(BaseModel):
    assessment: Optional[str] = Field(description="Injury risk assessment from the sports medicine specialist.")


@app.post("/injury-risk", response_model=InjuryRiskResponse)
def get_injury_risk_assessment(payload: InjuryRiskRequest) -> InjuryRiskResponse:
    """
    Generate injury risk assessment from the Injury Risk Assessment Agent.
    
    Analyzes pitcher workload, fatigue indicators, and usage patterns to assess
    injury risk and provide health recommendations.
    """
    assessment = None
    
    if settings.openai_api_key:
        assessment = generate_injury_risk_assessment(
            current_pitcher=payload.current_pitcher,
            recent_performance=payload.recent_performance,
            usage_history=payload.usage_history,
        )
    
    return InjuryRiskResponse(assessment=assessment)


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
