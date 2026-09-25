"""
Autonomous iterate-until-green loop for Heretek 3D Android Studio.

Flow per iteration:
    LLM (generate | repair) -> parse actions -> apply to the working scene
    -> invariant gate -> QA (headless engine run) -> verdict
    -> on failure: hand the failing rules + telemetry + scene back to the model

Stops when all acceptance rules pass ("green"), when the budget is exhausted
("unresolved"), or when the LLM/QA pipeline fails ("error"). Every iteration is
recorded with tokens, latency, apply outcomes, gate results, and QA metrics so
the run log doubles as a cost/latency dashboard.

CLI:
    python3 -m harness.loop.iterate_loop --goal "..." \\
        --scenario harness/config/scenarios/mini_arena.json --max-iterations 4
"""

import argparse
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from harness.loop.action_applier import ApplyResult, apply_actions
from harness.loop.llm_client import LlmClient, LlmError, LlmResponse
from harness.loop.prompts import generation_messages, repair_messages
from harness.loop.vision import VisionResult
from harness.validation.scene_invariants import validate_scene_invariants

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
NODE_RUNNER = REPO_ROOT / "harness" / "agents" / "qa_scenario_runner.mjs"
DEFAULT_RUNS_DIR = REPO_ROOT / "harness" / "runs" / "loop_runs"

QaRunner = Callable[[Path, int, Optional[Path]], Dict[str, Any]]
VisionCritique = Callable[[Dict[str, Any]], List[str]]


# --------------------------------------------------------------------------- parsing
def _salvage_actions(text: str) -> Optional[Tuple[Optional[str], List[Any]]]:
    """Recover complete action objects from truncated/malformed output."""
    summary_match = re.search(r'"summary"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
    summary = summary_match.group(1) if summary_match else None

    actions_idx = text.find('"actions"')
    if actions_idx == -1:
        return None
    arr_start = text.find("[", actions_idx)
    if arr_start == -1:
        return None

    actions: List[Any] = []
    depth = 0
    in_string = False
    escaped = False
    obj_start = -1
    for i in range(arr_start + 1, len(text)):
        ch = text[i]
        if escaped:
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            if depth == 0:
                obj_start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and obj_start != -1:
                candidate = text[obj_start : i + 1]
                try:
                    actions.append(json.loads(candidate))
                except json.JSONDecodeError:
                    pass
                obj_start = -1
        elif ch == "]" and depth == 0:
            break

    if not actions:
        return None
    return summary, actions


def parse_actions(text: str) -> Tuple[Optional[str], List[Any], str, Optional[str]]:
    """Parse an LLM response into (summary, actions, strategy, error)."""
    candidates: List[Tuple[str, str]] = []
    closed = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if closed:
        candidates.append(("codeblock", closed.group(1).strip()))
    else:
        opened = re.search(r"```(?:json)?\s*([\s\S]*)$", text)
        if opened:
            candidates.append(("codeblock", opened.group(1).strip()))
    candidates.append(("raw", text.strip()))

    last_error = "empty response"
    for strategy, payload in candidates:
        if not payload:
            continue
        try:
            data = json.loads(payload)
        except json.JSONDecodeError as error:
            last_error = f"{strategy}: {error}"
            continue
        if not isinstance(data, dict):
            last_error = f"{strategy}: root is not a JSON object"
            continue
        actions = data.get("actions")
        if not isinstance(actions, list):
            last_error = f"{strategy}: response has no 'actions' array"
            continue
        return data.get("summary"), actions, strategy, None

    salvaged = _salvage_actions(text)
    if salvaged is not None:
        summary, actions = salvaged
        return (
            summary,
            actions,
            "salvaged",
            f"primary parse failed ({last_error}); salvaged complete actions",
        )
    return None, [], "failed", last_error


# --------------------------------------------------------------------------- QA
def default_qa_runner(
    scenario_path: Path, frames: int, out_path: Optional[Path]
) -> Dict[str, Any]:
    """Run the real headless engine QA (Node runner) and return its report."""
    cmd = [
        "node",
        str(NODE_RUNNER),
        "--scenario",
        str(scenario_path),
        "--frames",
        str(frames),
    ]
    if out_path:
        cmd += ["--out", str(out_path)]
    proc = subprocess.run(
        cmd, capture_output=True, text=True, cwd=str(REPO_ROOT), timeout=900
    )
    if proc.returncode not in (0, 1):
        raise RuntimeError(
            f"QA runner failed (exit {proc.returncode}): {proc.stderr.strip()[:400]}"
        )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"QA runner emitted invalid JSON: {error}: {proc.stdout[:300]}"
        ) from error


def _normalize_vision(value: Any) -> Tuple[List[str], Optional[Dict[str, Any]]]:
    """Accept a `VisionResult` or a plain notes list; return (notes, telemetry)."""
    if isinstance(value, VisionResult):
        return (
            list(value.notes),
            {
                "model": value.model,
                "promptTokens": value.prompt_tokens,
                "completionTokens": value.completion_tokens,
                "totalTokens": value.total_tokens,
                "latencySeconds": round(value.latency_seconds, 3),
            },
        )
    if isinstance(value, list):
        return [str(v) for v in value], None
    return [], None


# --------------------------------------------------------------------------- loop
@dataclass
class LoopResult:
    verdict: str  # green | unresolved | error
    iterations: List[Dict[str, Any]] = field(default_factory=list)
    final_report: Optional[Dict[str, Any]] = None
    run_log_path: Optional[str] = None
    markdown_path: Optional[str] = None
    total_tokens: int = 0
    total_latency_seconds: float = 0.0
    error: Optional[str] = None


class IterateLoop:
    """Generate -> QA -> repair -> repeat, with budgets and per-iteration telemetry."""

    def __init__(
        self,
        goal: str,
        rules: List[Dict[str, Any]],
        client: LlmClient,
        *,
        qa_runner: QaRunner = default_qa_runner,
        max_iterations: int = 4,
        frames: int = 600,
        model: Optional[str] = None,
        work_scene_path: Optional[Path] = None,
        runs_dir: Optional[Path] = None,
        seed_scene: Optional[Dict[str, Any]] = None,
        vision_critique: Optional[VisionCritique] = None,
        max_total_tokens: Optional[int] = None,
        max_wall_seconds: Optional[float] = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.goal = goal
        self.rules = rules
        self.client = client
        self.qa_runner = qa_runner
        self.max_iterations = max_iterations
        self.frames = frames
        self.model = model
        self.work_scene_path = work_scene_path or (
            REPO_ROOT / "harness" / "scenes" / "loop_work_scene.json"
        )
        self.runs_dir = runs_dir or DEFAULT_RUNS_DIR
        self.seed_scene = seed_scene
        self.vision_critique = vision_critique
        self.max_total_tokens = max_total_tokens
        self.max_wall_seconds = max_wall_seconds
        self.clock = clock

    # ------------------------------------------------------------------ helpers
    def _base_scene(self) -> Dict[str, Any]:
        scene = {
            "id": "loop_work_scene",
            "name": "Loop Work Scene",
            "goal": self.goal,
            "gameObjects": [],
            "rules": self.rules,
        }
        if self.seed_scene:
            scene["gameObjects"] = json.loads(
                json.dumps(self.seed_scene.get("gameObjects", []))
            )
            if self.seed_scene.get("name"):
                scene["name"] = self.seed_scene["name"]
        return scene

    def _write_work_scene(self, scene: Dict[str, Any]) -> None:
        self.work_scene_path.parent.mkdir(parents=True, exist_ok=True)
        self.work_scene_path.write_text(json.dumps(scene, indent=2), encoding="utf-8")

    def _record_llm(
        self, response: Optional[LlmResponse], error: Optional[str] = None
    ) -> Dict[str, Any]:
        if response is None:
            return {"error": error or "llm call failed"}
        return {
            "model": response.model,
            "promptTokens": response.prompt_tokens,
            "completionTokens": response.completion_tokens,
            "totalTokens": response.total_tokens,
            "latencySeconds": round(response.latency_seconds, 3),
            "finishReason": response.finish_reason,
            "attempts": response.attempts,
        }

    def _write_run_log(self, result: LoopResult) -> None:
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        slug = re.sub(r"[^a-z0-9]+", "-", self.goal.lower())[:40].strip("-") or "run"
        log_path = self.runs_dir / f"{stamp}-{slug}.json"
        payload = {
            "goal": self.goal,
            "rules": self.rules,
            "verdict": result.verdict,
            "iterations": result.iterations,
            "totalTokens": result.total_tokens,
            "totalLatencySeconds": round(result.total_latency_seconds, 3),
            "finalReport": result.final_report,
            "error": result.error,
            "workScene": str(self.work_scene_path),
        }
        log_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        result.run_log_path = str(log_path)

        md_lines = [
            f"### Loop run — {self.goal}",
            "",
            f"- Verdict: **{result.verdict.upper()}** after {len(result.iterations)} iteration(s)",
            f"- Tokens: {result.total_tokens} · LLM latency: {result.total_latency_seconds:.1f}s",
        ]
        for record in result.iterations:
            qa = record.get("qa") or {}
            gate = record.get("gate") or {}
            md_lines.append(
                f"- Iteration {record['iteration']} ({record['phase']}): "
                f"applied {record.get('apply', {}).get('applied', 0)} actions, "
                f"gate {'ok' if gate.get('valid') else 'VIOLATED'}, "
                f"QA {qa.get('verdict', 'skipped')} ({qa.get('passed', '-')}/{qa.get('total', '-')} rules)"
            )
        md_path = log_path.with_suffix(".md")
        md_path.write_text("\n".join(md_lines) + "\n", encoding="utf-8")
        result.markdown_path = str(md_path)

    # -------------------------------------------------------------------- run
    def run(self) -> LoopResult:
        result = LoopResult(verdict="unresolved")
        scene = self._base_scene()
        started = self.clock()
        failed_rules: List[Dict[str, Any]] = []
        metrics: Dict[str, Any] = {}
        final_report: Optional[Dict[str, Any]] = None

        for iteration in range(1, self.max_iterations + 1):
            phase = "generate" if iteration == 1 else "repair"
            vision_notes: List[str] = []
            vision_record: Optional[Dict[str, Any]] = None
            if phase == "repair" and self.vision_critique is not None:
                try:
                    critique = self.vision_critique(scene, failed_rules)
                    vision_notes, vision_record = _normalize_vision(critique)
                except Exception as error:  # vision is advisory; never break the loop
                    vision_notes = [f"(vision critique failed: {error})"]
                    vision_record = {"error": str(error)}
                if vision_record:
                    result.total_tokens += int(vision_record.get("totalTokens") or 0)
                    result.total_latency_seconds += float(
                        vision_record.get("latencySeconds") or 0.0
                    )

            if phase == "generate":
                messages = generation_messages(
                    self.goal, self.rules, scene["gameObjects"] or None
                )
            else:
                messages = repair_messages(
                    self.goal,
                    self.rules,
                    scene,
                    failed_rules,
                    metrics,
                    iteration,
                    vision_notes,
                )

            record: Dict[str, Any] = {
                "iteration": iteration,
                "phase": phase,
                "visionNotes": vision_notes,
            }
            if vision_record:
                record["vision"] = vision_record

            try:
                response = self.client.chat(messages, model=self.model)
            except LlmError as error:
                record["llm"] = self._record_llm(None, str(error))
                record["error"] = str(error)
                result.iterations.append(record)
                result.verdict = "error"
                result.error = f"LLM call failed: {error}"
                break

            record["llm"] = self._record_llm(response)
            result.total_tokens += response.total_tokens
            result.total_latency_seconds += response.latency_seconds

            summary, actions, strategy, parse_error = parse_actions(response.text)
            record["parse"] = {
                "strategy": strategy,
                "actionCount": len(actions),
                "summary": summary,
                "error": parse_error,
            }

            scene, apply_result = apply_actions(scene, actions)
            record["apply"] = apply_result.as_dict()

            valid, violations = validate_scene_invariants(scene)
            record["gate"] = {"valid": valid, "violations": violations}

            if valid:
                self._write_work_scene(scene)
                try:
                    report = self.qa_runner(self.work_scene_path, self.frames, None)
                except Exception as error:
                    # QA-runner crash: repairable, not terminal. Feed the crash
                    # detail back as a synthetic failure so the next repair
                    # iteration can fix the scene (still bounded by budgets below).
                    record["qa"] = {"verdict": "error", "error": str(error)}
                    failed_rules = [
                        {
                            "id": "qa_runner",
                            "type": "error",
                            "detail": f"QA runner crashed: {error}"[:500],
                        }
                    ]
                    metrics = {}
                else:
                    final_report = report
                    record["qa"] = {
                        "verdict": report.get("verdict"),
                        "passed": report.get("passed"),
                        "total": report.get("total"),
                        "failedRules": [
                            {
                                "id": r.get("id"),
                                "type": r.get("type"),
                                "detail": r.get("detail"),
                            }
                            for r in report.get("rules", [])
                            if not r.get("pass")
                        ],
                        "metrics": report.get("metrics", {}),
                    }
                    failed_rules = [
                        r for r in report.get("rules", []) if not r.get("pass")
                    ]
                    metrics = report.get("metrics", {})

                    if report.get("verdict") in ("SUCCEEDED",) or (
                        report.get("total")
                        and report.get("passed") == report.get("total")
                    ):
                        result.iterations.append(record)
                        result.verdict = "green"
                        break
            else:
                # Gate violation: skip QA, feed the violations back as failures.
                failed_rules = [
                    {
                        "id": v.get("code"),
                        "type": "invariant",
                        "detail": v.get("message"),
                    }
                    for v in violations
                ]
                metrics = {}
                record["qa"] = {
                    "verdict": "skipped",
                    "reason": "invariant gate violation",
                }

            result.iterations.append(record)

            # Budgets
            if (
                self.max_total_tokens is not None
                and result.total_tokens >= self.max_total_tokens
            ):
                result.error = f"token budget exhausted ({result.total_tokens} >= {self.max_total_tokens})"
                break
            if (
                self.max_wall_seconds is not None
                and (self.clock() - started) >= self.max_wall_seconds
            ):
                result.error = (
                    f"wall-clock budget exhausted ({self.clock() - started:.0f}s)"
                )
                break

        result.final_report = final_report
        self._write_run_log(result)
        return result


# --------------------------------------------------------------------------- CLI
def _load_rules(
    args: argparse.Namespace,
) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    if args.scenario:
        scenario = json.loads(Path(args.scenario).read_text(encoding="utf-8"))
        return scenario.get("rules", []), scenario
    if args.rules:
        data = json.loads(Path(args.rules).read_text(encoding="utf-8"))
        return (data if isinstance(data, list) else data.get("rules", [])), None
    return [], None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Autonomous iterate-until-green harness loop"
    )
    parser.add_argument(
        "--goal", required=True, help="Game/scene design goal for the model"
    )
    parser.add_argument(
        "--scenario",
        help="Scenario JSON supplying the acceptance rules (and optional seed objects)",
    )
    parser.add_argument(
        "--rules", help="JSON file with a rules array (alternative to --scenario)"
    )
    parser.add_argument(
        "--seed",
        action="store_true",
        help="Seed the working scene with the scenario's gameObjects",
    )
    parser.add_argument("--max-iterations", type=int, default=4)
    parser.add_argument("--frames", type=int, default=600)
    parser.add_argument("--model", default=None, help="Override the chat model")
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=None,
        help="Total token budget across iterations",
    )
    parser.add_argument(
        "--max-seconds",
        type=float,
        default=None,
        help="Wall-clock budget across iterations",
    )
    parser.add_argument(
        "--work-scene",
        default=None,
        help="Working scene path (default harness/scenes/loop_work_scene.json)",
    )
    parser.add_argument(
        "--vision",
        action="store_true",
        help="Enable the layout-preview vision critique before repairs",
    )
    parser.add_argument(
        "--vision-model",
        default=None,
        help="Vision model route (default auto/best-vision)",
    )
    args = parser.parse_args()

    rules, scenario = _load_rules(args)
    if not rules:
        print(
            "error: no acceptance rules found (pass --scenario or --rules)",
            file=sys.stderr,
        )
        return 2

    client = LlmClient()
    vision = None
    if args.vision:
        from harness.loop.vision import make_layout_critique

        vision = make_layout_critique(client, model=args.vision_model)

    loop = IterateLoop(
        args.goal,
        rules,
        client,
        max_iterations=args.max_iterations,
        frames=args.frames,
        model=args.model,
        work_scene_path=Path(args.work_scene) if args.work_scene else None,
        seed_scene=scenario if (args.seed and scenario) else None,
        vision_critique=vision,
        max_total_tokens=args.max_tokens,
        max_wall_seconds=args.max_seconds,
    )
    result = loop.run()

    print(
        f"\nverdict: {result.verdict.upper()} after {len(result.iterations)} iteration(s)"
    )
    print(
        f"tokens: {result.total_tokens} | llm latency: {result.total_latency_seconds:.1f}s"
    )
    if result.error:
        print(f"note: {result.error}")
    print(f"run log: {result.run_log_path}")
    if result.final_report:
        print(
            f"QA: {result.final_report.get('passed')}/{result.final_report.get('total')} rules passed"
        )
    return 0 if result.verdict == "green" else 1


if __name__ == "__main__":
    sys.exit(main())
