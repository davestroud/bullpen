from __future__ import annotations

from typing import List, Optional, Tuple, TypedDict

from langgraph.graph import END, StateGraph

from .data import DataLoadError, load_relievers, refresh_relievers_csv
from .llm import generate_explanation
from .models import Reliever
from .scoring import BatterSide, LeverageLevel, rank_relievers
from .settings import settings
from .statcast import StatcastError


class AgentContext(TypedDict):
    """Minimal context needed to run the multi-agent workflow."""

    batter: BatterSide
    leverage: LeverageLevel
    exclude: List[str]


class RecommendationState(TypedDict, total=False):
    request: AgentContext
    relievers: List[Reliever]
    scored: List[Tuple[Reliever, float]]
    explanation: Optional[str]
    notes: List[str]


def _load_relievers_node(state: RecommendationState) -> RecommendationState:
    notes = list(state.get("notes", []))

    try:
        relievers = load_relievers(settings.data_path)
    except DataLoadError:
        try:
            rows_written = refresh_relievers_csv(data_path=settings.data_path)
            notes.append(
                f"Auto-refreshed reliever CSV with {rows_written} Statcast rows."
            )
            relievers = load_relievers(settings.data_path)
        except StatcastError as exc:  # pragma: no cover - relies on networked pybaseball
            notes.append(f"Statcast refresh failed: {exc}")
            raise

    return {**state, "relievers": relievers, "notes": notes}


def _scoring_node(state: RecommendationState) -> RecommendationState:
    relievers = state.get("relievers")
    request = state.get("request")

    if not relievers or not request:
        raise ValueError("RecommendationState requires relievers and request data")

    _, scored_pairs = rank_relievers(
        relievers=relievers,
        batter=request["batter"],
        leverage=request["leverage"],
        exclude=request.get("exclude", []),
    )

    return {**state, "scored": scored_pairs}


def _explanation_node(state: RecommendationState) -> RecommendationState:
    notes = list(state.get("notes", []))
    scored = state.get("scored", [])
    request = state.get("request") or {}

    if not scored:
        notes.append("No scored relievers available for explanation.")
        return {**state, "notes": notes}

    if not settings.openai_api_key:
        notes.append("LLM explanation skipped (OPENAI_API_KEY not set).")
        return {**state, "notes": notes}

    explanation = generate_explanation(
        context=request,
        top3=[
            {
                "name": reliever.name,
                "throws": reliever.throws,
                "era": reliever.era,
                "whip": reliever.whip,
                "k9": reliever.k_per_9,
                "bb9": reliever.bb_per_9,
                "vsL_woba": reliever.vs_left_woba,
                "vsR_woba": reliever.vs_right_woba,
                "days_rest": reliever.days_rest,
                "score": score,
            }
            for reliever, score in scored[:3]
        ],
    )

    return {**state, "explanation": explanation, "notes": notes}


def _critic_node(state: RecommendationState) -> RecommendationState:
    notes = list(state.get("notes", []))
    scored = state.get("scored", [])
    explanation = state.get("explanation")

    if not scored:
        notes.append("No relievers scored; nothing to critique.")
        return {**state, "notes": notes}

    top_name = scored[0][0].name

    if explanation:
        if top_name.lower() not in explanation.lower():
            notes.append(
                "Critic: explanation omitted the top candidate's name; consider regenerating."
            )
        else:
            notes.append("Critic: explanation references the top candidate by name.")
    else:
        notes.append("Critic: no explanation generated; deterministic ranking only.")

    return {**state, "notes": notes}


def build_recommendation_graph() -> StateGraph:
    """Construct a LangGraph StateGraph representing the bullpen agents."""

    graph = StateGraph(RecommendationState)
    graph.add_node("load_data", _load_relievers_node)
    graph.add_node("score", _scoring_node)
    graph.add_node("explain", _explanation_node)
    graph.add_node("critic", _critic_node)

    graph.set_entry_point("load_data")
    graph.add_edge("load_data", "score")
    graph.add_edge("score", "explain")
    graph.add_edge("explain", "critic")
    graph.add_edge("critic", END)

    return graph


def run_multi_agent_recommendation(context: AgentContext) -> RecommendationState:
    """
    Run the LangGraph-based multi-agent workflow and return the final state.

    This mirrors the LangGraph + LangSmith pattern outlined in
    https://levelup.gitconnected.com/building-a-multi-agent-ai-system-with-langgraph-and-langsmith-6cb70487cd81
    while reusing the deterministic scorer and optional LLM explainer from the
    Bullpen service.
    """

    graph = build_recommendation_graph().compile()
    initial_state: RecommendationState = {"request": context, "notes": []}
    return graph.invoke(initial_state)
