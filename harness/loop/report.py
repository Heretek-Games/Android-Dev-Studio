"""
Cost/latency dashboard for iterate-until-green loop runs.

Reads the JSON run logs written by `IterateLoop` and summarizes them: verdict
counts, iterations-to-green, token totals, LLM latency, and per-run detail.
Emits a markdown table (and optional JSON) so runs are comparable across models
and prompt changes — no invented cost figures, only measured tokens/time.

CLI:
    python3 -m harness.loop.report                       # print markdown summary
    python3 -m harness.loop.report --json                # machine-readable
    python3 -m harness.loop.report --out harness/runs/loop_runs/SUMMARY.md
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_RUNS_DIR = REPO_ROOT / "harness" / "runs" / "loop_runs"


def load_runs(runs_dir: Path) -> List[Dict[str, Any]]:
    runs: List[Dict[str, Any]] = []
    if not runs_dir.exists():
        return runs
    for path in sorted(runs_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(data, dict) and "verdict" in data and "iterations" in data:
            data["_path"] = str(path)
            runs.append(data)
    return runs


def build_summary(runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    verdicts = {"green": 0, "unresolved": 0, "error": 0}
    total_tokens = 0
    total_latency = 0.0
    iterations_to_green: List[int] = []
    rows: List[Dict[str, Any]] = []

    for run in runs:
        verdict = str(run.get("verdict", "unknown"))
        verdicts[verdict] = verdicts.get(verdict, 0) + 1
        tokens = int(run.get("totalTokens") or 0)
        latency = float(run.get("totalLatencySeconds") or 0.0)
        total_tokens += tokens
        total_latency += latency
        iterations = run.get("iterations") or []
        if verdict == "green":
            iterations_to_green.append(len(iterations))
        rows.append(
            {
                "goal": str(run.get("goal", ""))[:60],
                "verdict": verdict,
                "iterations": len(iterations),
                "tokens": tokens,
                "latencySeconds": round(latency, 1),
                "path": run.get("_path", ""),
            }
        )

    return {
        "runs": len(runs),
        "verdicts": verdicts,
        "totalTokens": total_tokens,
        "totalLatencySeconds": round(total_latency, 1),
        "avgIterationsToGreen": (
            round(sum(iterations_to_green) / len(iterations_to_green), 2)
            if iterations_to_green
            else None
        ),
        "rows": rows,
    }


def render_markdown(summary: Dict[str, Any]) -> str:
    lines = [
        "# Iterate-Until-Green Loop — Run Dashboard",
        "",
        f"- Runs: **{summary['runs']}** "
        f"(green {summary['verdicts'].get('green', 0)}, "
        f"unresolved {summary['verdicts'].get('unresolved', 0)}, "
        f"error {summary['verdicts'].get('error', 0)})",
        f"- Tokens: **{summary['totalTokens']}** · LLM latency: **{summary['totalLatencySeconds']}s**",
    ]
    if summary.get("avgIterationsToGreen") is not None:
        lines.append(
            f"- Avg iterations to green: **{summary['avgIterationsToGreen']}**"
        )
    lines += [
        "",
        "| Goal | Verdict | Iterations | Tokens | LLM latency (s) |",
        "|------|---------|-----------|--------|-----------------|",
    ]
    for row in summary["rows"]:
        lines.append(
            f"| {row['goal']} | {row['verdict']} | {row['iterations']} | {row['tokens']} | {row['latencySeconds']} |"
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Loop run dashboard (cost/latency/verdicts)"
    )
    parser.add_argument("--runs-dir", default=str(DEFAULT_RUNS_DIR))
    parser.add_argument(
        "--out", default=None, help="Write the markdown summary to this path"
    )
    parser.add_argument(
        "--json", action="store_true", help="Emit JSON instead of markdown"
    )
    args = parser.parse_args()

    summary = build_summary(load_runs(Path(args.runs_dir)))
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        markdown = render_markdown(summary)
        if args.out:
            Path(args.out).write_text(markdown, encoding="utf-8")
            print(f"wrote {args.out}")
        else:
            print(markdown)
    return 0


if __name__ == "__main__":
    sys.exit(main())
