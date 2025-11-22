from __future__ import annotations

import argparse
import json

from bullpen.agents import AgentContext, run_multi_agent_recommendation


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the LangGraph multi-agent bullpen workflow."
    )
    parser.add_argument("--batter", choices=["L", "R"], required=True)
    parser.add_argument(
        "--leverage",
        choices=["low", "medium", "high"],
        default="medium",
        help="Game leverage level (default: medium).",
    )
    parser.add_argument(
        "--exclude",
        nargs="*",
        default=[],
        help="Reliever names to skip (space-separated).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    context: AgentContext = {
        "batter": args.batter,
        "leverage": args.leverage,
        "exclude": [name.strip() for name in args.exclude if name.strip()],
    }

    result = run_multi_agent_recommendation(context)

    output = {
        "request": result.get("request"),
        "notes": result.get("notes", []),
        "top_relievers": [
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
            for reliever, score in result.get("scored", [])[:3]
        ],
        "explanation": result.get("explanation"),
    }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
