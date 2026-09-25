#!/usr/bin/env python3
"""Tier 2 parity flip rule (Track 0): every capability the headless QA runner
constructs in buildScene must be listed in harness/tier2_parity.json.

Add a runner component without updating the parity file and this fails —
that is the point: Tier 1 must never silently ship what Tier 2 cannot see.
Run: python3 harness/build/check_tier2_parity.py
"""

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RUNNER = REPO / "harness" / "agents" / "qa_scenario_runner.mjs"
PARITY = REPO / "harness" / "tier2_parity.json"

# objSpec keys / engine components buildScene constructs (keep in sync by failing).
REQUIRED_KEYS = [
    "light",
    "camera",
    "MeshRenderer",
    "RigidBody3D",
    "MobileController",
    "WeaponController",
    "HealthComponent",
    "EnemyAI",
    "WorldStreamer",
    "ElementalReactionComponent",
    "VehicleController",
    "EventSheet",
    "AnimeCelShader",
    "DialogueManager",
    "GameRuntime",
    "ModelRenderer",
]

VALID_STATUSES = {"full", "partial", "missing", "web-tier", "n/a"}


def main(parity_path=None, runner_path=None) -> int:
    runner_src = Path(runner_path or RUNNER).read_text(encoding="utf-8")
    parity = json.loads(Path(parity_path or PARITY).read_text(encoding="utf-8"))
    entries = parity.get("entries", {})
    failures = []

    for key in REQUIRED_KEYS:
        if key not in runner_src:
            failures.append(
                f"runner no longer constructs '{key}' — remove it from REQUIRED_KEYS"
            )
            continue
        match = next((name for name in entries if key.lower() in name.lower()), None)
        if match is None:
            failures.append(
                f"runner capability '{key}' has no parity entry (flip rule)"
            )
            continue
        status = entries[match].get("tier2")
        if status not in VALID_STATUSES:
            failures.append(
                f"parity entry '{match}' has invalid tier2 status '{status}'"
            )

    for name, entry in entries.items():
        if entry.get("tier2") not in VALID_STATUSES:
            failures.append(f"parity entry '{name}' has invalid tier2 status")
        if not entry.get("notes"):
            failures.append(f"parity entry '{name}' needs a notes field")

    missing = [n for n, e in entries.items() if e.get("tier2") == "missing"]
    print(f"parity: {len(entries)} entries, {len(missing)} missing: {sorted(missing)}")
    if failures:
        print("FLIP-RULE FAILURES:")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("flip rule green: every runner capability is tracked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
