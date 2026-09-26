"""First-pass genre-template gate (Track 3; ADR-1790382731036).

Runs every harness/briefs/examples/*.json brief through production_run with
max-iterations 1 (single generate + QA, zero repairs) and emits a verdict
matrix. Green on first pass = verdict GREEN. Failures triage as template
defects (fix the brief) vs loop defects (fix the loop), then re-run failed.

Usage:
    python3 -m harness.briefs.first_pass [--brief NAME] [--max-seconds S]
    python3 -m harness.briefs.first_pass --report-only
"""

import glob
import json
import os
import subprocess
import sys
import time

EXAMPLES_DIR = os.path.join(os.path.dirname(__file__), "examples")
REPORT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "runs", "first_pass_report.json"
)


def run_brief(brief_path, max_seconds=900):
    """Runs one brief; returns (verdict_dict, wall_seconds)."""
    started = time.time()
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "harness.loop.production_run",
            "--brief",
            brief_path,
            "--max-iterations",
            "1",
            "--max-seconds",
            str(max_seconds),
            "--json",
        ],
        capture_output=True,
        text=True,
        cwd=os.path.join(os.path.dirname(__file__), "..", ".."),
    )
    wall = time.time() - started
    raw = proc.stdout.strip()
    try:
        verdict = json.loads(raw[raw.index("{") :])
    except (ValueError, IndexError):
        verdict = {"verdict": "error", "error": proc.stderr[-2000:]}
    return verdict, wall


def summarize(brief_path, verdict, wall):
    name = os.path.basename(brief_path)
    criteria = verdict.get("criteria", [])
    failed = [c.get("id") for c in criteria if c.get("state") not in ("pass", "passed")]
    return {
        "brief": name,
        "verdict": verdict.get("verdict", "error"),
        "wall_seconds": round(wall, 1),
        "tokens": verdict.get("totalTokens", verdict.get("total_tokens", 0)),
        "criteria_total": len(criteria),
        "criteria_failed": failed,
        "defects": verdict.get("defectReport", verdict.get("defect_report", []))[:5],
    }


def main(argv=None):
    import argparse

    parser = argparse.ArgumentParser(description="First-pass genre template gate")
    parser.add_argument(
        "--brief", help="Single example basename (e.g. arena_defense.json)"
    )
    parser.add_argument("--max-seconds", type=float, default=900)
    parser.add_argument("--report-only", action="store_true")
    args = parser.parse_args(argv)

    if args.report_only:
        if not os.path.isfile(REPORT_PATH):
            print("no report yet")
            return 1
        report = json.load(open(REPORT_PATH))
        for row in report["rows"]:
            print(f"{row['verdict']:>8}  {row['brief']}")
        return 0 if report["green"] == report["total"] else 1

    briefs = sorted(glob.glob(os.path.join(EXAMPLES_DIR, "*.json")))
    if args.brief:
        briefs = [b for b in briefs if os.path.basename(b) == args.brief]
        if not briefs:
            print(f"unknown brief {args.brief}")
            return 1
    # Resume: keep rows already green in the existing report.
    rows = []
    if os.path.isfile(REPORT_PATH):
        try:
            prior = json.load(open(REPORT_PATH))
            rows = [r for r in prior.get("rows", []) if r.get("verdict") == "green"]
            done = {r["brief"] for r in rows}
            briefs = [b for b in briefs if os.path.basename(b) not in done]
        except (ValueError, OSError):
            rows = []

    def write_report():
        green = sum(1 for r in rows if r["verdict"] == "green")
        os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
        with open(REPORT_PATH, "w", encoding="utf-8") as fh:
            json.dump({"total": len(rows), "green": green, "rows": rows}, fh, indent=1)
        return green

    for path in briefs:
        print(f"--- {os.path.basename(path)}", flush=True)
        verdict, wall = run_brief(path, args.max_seconds)
        rows.append(summarize(path, verdict, wall))
        green = write_report()
        print(
            f"    {rows[-1]['verdict']} ({rows[-1]['wall_seconds']}s, "
            f"{rows[-1]['tokens']} tokens) [{green}/{len(rows)} green]",
            flush=True,
        )
    green = sum(1 for r in rows if r["verdict"] == "green")
    print(f"\nfirst-pass: {green}/{len(rows)} green -> {REPORT_PATH}")
    return 0 if rows and green == len(rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
