#!/usr/bin/env python3
"""
Artemis QA Runner for Android 3D Games — real closed-loop orchestration.

Boots target game scenarios headless on the real @heretek/engine runtime via
harness/agents/qa_scenario_runner.mjs, records real performance telemetry
(FPS estimate, frame time, GPU draw-call estimate, memory heap), evaluates
game-rule specifications, and compares the result against the most recent
benchmark persisted in project_memory.py to detect regressions.

Device note: ADB enumeration is reported as device context only. The headless
simulation itself runs on the engine runtime (no GPU required), so results are
deterministic and CI-friendly. On-device Artemis UI-driving remains available
through the MCP `studio_run_artemis_qa` tool path for device-specific passes.

Adheres to the Dynamic-First, Coordinate-Fallback locator pattern for any
on-device steps documented in harness/config/artemis_game_rules.md.
"""

import sys
import json
import argparse
import subprocess
import time
import os

HARNESS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(HARNESS_DIR)
NODE_RUNNER = os.path.join(HARNESS_DIR, "agents", "qa_scenario_runner.mjs")
DEFAULT_SCENARIO = os.path.join(HARNESS_DIR, "config", "scenarios", "mini_arena.json")

# Regression thresholds versus the persisted baseline benchmark
REGRESSION_THRESHOLDS = {
    "fps_average": ("drop", 0.20),  # >20% slower sim throughput
    "frame_time_ms": ("rise", 0.20),  # >20% higher frame cost
    "draw_calls": ("rise", 0.25),  # >25% more draw calls
    "heap_mb": ("rise", 0.30),  # >30% more heap
}


def parse_args():
    parser = argparse.ArgumentParser(description="Artemis Headless Game QA Runner")
    parser.add_argument(
        "--goal",
        type=str,
        default="Navigate player character past obstacle course and verify 60 FPS",
        help="Natural language QA goal",
    )
    parser.add_argument(
        "--serial",
        type=str,
        default=None,
        help="ADB target device serial (device context)",
    )
    parser.add_argument(
        "--profile",
        type=str,
        choices=["flash", "pro"],
        default="flash",
        help="Artemis model profile",
    )
    parser.add_argument(
        "--scenario",
        type=str,
        default=DEFAULT_SCENARIO,
        help="Scenario spec JSON for the headless engine runner",
    )
    parser.add_argument(
        "--frames", type=int, default=600, help="Number of fixed-dt frames to simulate"
    )
    parser.add_argument(
        "--report",
        type=str,
        default=os.path.join(HARNESS_DIR, "artemis_report.json"),
        help="Path to write JSON telemetry report",
    )
    parser.add_argument(
        "--json", action="store_true", help="Print the raw JSON report to stdout only"
    )
    parser.add_argument(
        "--no-record",
        action="store_true",
        help="Do not persist the benchmark to project_memory",
    )
    parser.add_argument(
        "--no-baseline",
        action="store_true",
        help="Skip regression comparison against project_memory",
    )
    parser.add_argument(
        "--vision",
        action="store_true",
        help="Run the multimodal layout critique and attach its notes to the report (advisory only; never changes the verdict)",
    )
    parser.add_argument(
        "--vision-model",
        type=str,
        default=None,
        help="Vision model route (default: auto/best-vision)",
    )
    return parser.parse_args()


def check_adb_devices():
    try:
        out = subprocess.check_output(["adb", "devices", "-l"], text=True)
        lines = [
            line.strip()
            for line in out.splitlines()
            if line.strip() and not line.startswith("List of")
        ]
        return lines
    except Exception:
        return []


def build_vision_block(scenario, failed_rules, critique_fn):
    """Build the report's vision block via an injected critique callable.

    critique_fn(png_bytes, failed_rules) must return a dict with notes (list),
    model (str), totalTokens (int) and latencySeconds (float). Never raises:
    missing geometry yields a skipped block, critique failures yield an error
    block. The vision critique is advisory — callers must not let it change
    the QA verdict.
    """
    objects = [
        o for o in (scenario or {}).get("gameObjects", []) if isinstance(o, dict)
    ]
    if not objects:
        return {"status": "skipped", "reason": "scenario has no gameObjects to preview"}
    try:
        if HARNESS_DIR not in sys.path:
            sys.path.insert(0, HARNESS_DIR)
        from loop.scene_preview import render_layout_png

        png = render_layout_png({"gameObjects": objects})
    except Exception as e:
        return {"status": "skipped", "reason": f"layout preview unavailable: {e}"}
    try:
        result = critique_fn(png, failed_rules)
    except Exception as e:
        return {"status": "error", "error": str(e)[:300], "notes": []}
    notes = result.get("notes") or []
    return {
        "status": "ok",
        "notes": list(notes),
        "model": result.get("model", ""),
        "totalTokens": int(result.get("totalTokens") or 0),
        "latencySeconds": round(float(result.get("latencySeconds") or 0.0), 3),
    }


def default_vision_critique(model=None):
    """Real critique callable backed by the loop's vision route (needs LLM creds)."""

    def critique_fn(png_bytes, failed_rules):
        if HARNESS_DIR not in sys.path:
            sys.path.insert(0, HARNESS_DIR)
        if REPO_ROOT not in sys.path:
            sys.path.insert(0, REPO_ROOT)
        from loop.llm_client import LlmClient
        from loop.vision import critique_frame

        client = LlmClient()
        result = critique_frame(
            client, png_bytes, model=model, failed_rules=failed_rules
        )
        if result.error:
            raise RuntimeError(result.error)
        return {
            "notes": result.notes,
            "model": result.model,
            "totalTokens": result.total_tokens,
            "latencySeconds": result.latency_seconds,
        }

    return critique_fn


def run_headless_scenario(scenario_path, frames, report_path):
    """Boot the scenario on the real engine runtime and return its report dict."""
    cmd = [
        "node",
        NODE_RUNNER,
        "--scenario",
        scenario_path,
        "--frames",
        str(frames),
    ]
    if report_path:
        cmd += ["--out", report_path]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT)
    if proc.returncode not in (0, 1):
        raise RuntimeError(
            f"qa_scenario_runner.mjs failed (exit {proc.returncode}): {proc.stderr.strip()[:500]}"
        )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"qa_scenario_runner.mjs emitted invalid JSON: {e}: {proc.stdout[:300]}"
        )


def compare_to_baseline(current, baseline):
    """Return a list of regression findings against the persisted baseline."""
    findings = []
    if not baseline:
        return findings
    cur = current.get("metrics", {})
    mapping = {
        "fps_average": cur.get("simFpsEstimate"),
        "frame_time_ms": cur.get("avgFrameTimeMs"),
        "draw_calls": cur.get("drawCallEstimate"),
        "heap_mb": cur.get("memoryHeapMb"),
    }
    for key, (direction, threshold) in REGRESSION_THRESHOLDS.items():
        base_val = baseline.get(key)
        cur_val = mapping.get(key)
        if not base_val or cur_val is None:
            continue
        if direction == "drop" and cur_val < base_val * (1 - threshold):
            findings.append(
                f"{key} regressed: {cur_val:.2f} vs baseline {base_val:.2f} (-{threshold:.0%} threshold)"
            )
        elif direction == "rise" and cur_val > base_val * (1 + threshold):
            findings.append(
                f"{key} regressed: {cur_val:.2f} vs baseline {base_val:.2f} (+{threshold:.0%} threshold)"
            )
    return findings


def main():
    args = parse_args()
    log = (lambda *a: None) if args.json else print

    log("=" * 65)
    log("🤖 Google Artemis Autonomous Game QA Harness (headless engine run)")
    log("=" * 65)

    devices = check_adb_devices()
    target_serial = args.serial
    if not target_serial:
        if devices:
            target_serial = devices[0].split()[0]
            log(f"[+] Auto-selected connected device (context): {target_serial}")
        else:
            target_serial = "headless-sim"
            log(
                "[*] No live hardware detected — running deterministic headless simulation"
            )
    else:
        log(f"[+] Target device serial (context): {target_serial}")

    log(f"🎯 Objective: {args.goal}")
    log(f"📁 Scenario: {os.path.relpath(args.scenario, REPO_ROOT)}")
    log(f"🎞  Frames: {args.frames} (fixed dt)")
    log("-" * 65)

    started = time.time()
    try:
        report = run_headless_scenario(args.scenario, args.frames, args.report)
    except Exception as e:
        failure = {
            "schemaVersion": 1,
            "runner": "artemis_qa_runner.py",
            "goal": args.goal,
            "scenario": os.path.basename(args.scenario),
            "device": target_serial,
            "profile": args.profile,
            "timestamp": time.time(),
            "verdict": "FAILED",
            "error": str(e),
            "rules": [],
            "passed": 0,
            "total": 0,
            "confidence": 0.0,
        }
        with open(args.report, "w") as f:
            json.dump(failure, f, indent=2)
        if args.json:
            print(json.dumps(failure, indent=2))
        else:
            print(f"[-] Scenario execution failed: {e}", file=sys.stderr)
        sys.exit(3)

    metrics = report.get("metrics", {})
    report["runner"] = "artemis_qa_runner.py"
    report["device"] = target_serial
    report["profile"] = args.profile
    report["wallClockSeconds"] = round(time.time() - started, 3)

    # --- Opt-in multimodal layout critique (advisory; never changes verdict) ---
    if args.vision:
        try:
            with open(args.scenario, "r", encoding="utf-8") as f:
                scenario_spec = json.load(f)
        except Exception as e:
            scenario_spec = {}
            log(f"[!] Vision critique skipped (unreadable scenario): {e}")
        if isinstance(scenario_spec, dict) and scenario_spec:
            failed_rules = [r for r in report.get("rules", []) if not r.get("pass")]
            report["vision"] = build_vision_block(
                scenario_spec,
                failed_rules,
                default_vision_critique(model=args.vision_model),
            )
            vision = report["vision"]
            if vision.get("status") == "ok":
                log(
                    f"👁  Vision critique ({vision.get('model')}): {len(vision.get('notes', []))} note(s)"
                )
                for note in vision.get("notes", []):
                    log(f"     - {note}")
            else:
                log(
                    f"👁  Vision critique {vision.get('status')}: {vision.get('reason', vision.get('error', ''))}"
                )
        else:
            report["vision"] = {
                "status": "skipped",
                "reason": "unreadable scenario spec",
            }

    # --- Regression comparison against project_memory baseline ---
    regression_findings = []
    baseline = None
    if not args.no_baseline:
        try:
            sys.path.insert(0, HARNESS_DIR)
            from memory.project_memory import ProjectMemory

            memory = ProjectMemory()
            prior = memory.get_latest_benchmarks(limit=20)
            scenario_name = os.path.basename(args.scenario)
            # Baselines are only comparable within the same scenario — never
            # compare metrics across different scene specs.
            same_scenario = [b for b in prior if b.get("scenario") == scenario_name]
            exact = [b for b in same_scenario if b.get("goal") == args.goal]
            if exact:
                baseline = exact[0]
            elif same_scenario:
                baseline = same_scenario[0]
            regression_findings = compare_to_baseline(report, baseline)
        except Exception as e:
            log(f"[!] Baseline comparison unavailable: {e}")

    if regression_findings:
        report["regressions"] = regression_findings
        if report.get("verdict") == "SUCCEEDED":
            report["verdict"] = "REGRESSED"
    report["baselineComparedAgainst"] = (
        {
            "id": baseline.get("id"),
            "created_at": baseline.get("created_at"),
            "fps_average": baseline.get("fps_average"),
        }
        if baseline
        else None
    )

    # --- Persist the real benchmark for future regression comparisons ---
    if not args.no_record:
        try:
            sys.path.insert(0, HARNESS_DIR)
            from memory.project_memory import ProjectMemory

            memory = ProjectMemory()
            memory.record_qa_benchmark(
                goal=args.goal,
                device_serial=target_serial,
                fps=float(metrics.get("simFpsEstimate", 0)),
                frame_time_ms=float(metrics.get("avgFrameTimeMs", 0)),
                vram_mb=0.0,
                exceptions=0,
                verdict=report["verdict"],
                draw_calls=int(metrics.get("drawCallEstimate", 0)),
                heap_mb=float(metrics.get("memoryHeapMb", 0)),
                scenario=os.path.basename(args.scenario),
            )
            log(
                "[+] Benchmark persisted to project_memory (harness/project_memory.sqlite)"
            )
        except Exception as e:
            log(f"[!] Could not persist benchmark: {e}")

    with open(args.report, "w") as f:
        json.dump(report, f, indent=2)

    if args.json:
        print(json.dumps(report, indent=2))
        sys.exit(0 if report.get("verdict") in ("SUCCEEDED",) else 1)

    log("-" * 65)
    log(
        f"📋 Rules passed: {report['passed']}/{report['total']} (confidence {report['confidence']:.1%})"
    )
    for rule in report.get("rules", []):
        mark = "✅" if rule["pass"] else "❌"
        log(f"  {mark} {rule['id']}: {rule['detail']}")
    log("-" * 65)
    log("📊 Telemetry (headless engine runtime):")
    log(
        f"   Sim FPS estimate : {metrics.get('simFpsEstimate')} (avg frame {metrics.get('avgFrameTimeMs')} ms, p95 {metrics.get('p95FrameTimeMs')} ms)"
    )
    log(
        f"   GPU draw calls   : {metrics.get('drawCallEstimate')} (instanced batches: {metrics.get('instancedBatches')}) — mobile budget 100"
    )
    log(f"   Memory heap      : {metrics.get('memoryHeapMb')} MB")
    log(
        f"   Scene            : {metrics.get('objectCount')} objects, {metrics.get('physicsBodyCount')} physics bodies, {metrics.get('eventCount')} events"
    )
    if regression_findings:
        log("⚠  Regression findings vs baseline:")
        for finding in regression_findings:
            log(f"   - {finding}")
    elif baseline:
        log(f"✅ No regressions vs baseline #{baseline.get('id')}")
    else:
        log("ℹ  No prior baseline — this run establishes one")
    log("-" * 65)
    verdict = report["verdict"]
    emoji = {"SUCCEEDED": "✅", "REGRESSED": "⚠️", "FAILED": "❌"}.get(verdict, "•")
    log(f"{emoji} Artemis Verdict: {verdict} (confidence {report['confidence']:.1%})")
    log(f"📁 Report written: {args.report}")
    log("=" * 65)
    sys.exit(0 if verdict == "SUCCEEDED" else 1)


if __name__ == "__main__":
    main()
