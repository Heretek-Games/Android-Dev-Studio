#!/usr/bin/env python3
"""
Swarm CLI — dev-server bridge for the Agent Swarm dock.

Runs the real multi-agent orchestrator pipeline (decompose -> architect ->
invariant audit -> headless QA -> review) and prints a JSON result including
the real task log, ADRs, and latest QA benchmarks from project memory.

Usage:
    python3 harness/agents/swarm_cli.py "<game design prompt>"

Output: {"ok": true, "prompt": ..., "log": [...], "adrs": [...], "latest_qa": [...], "project_status": {...}}
"""

import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO_ROOT)

from harness.orchestrator.agent_swarm import AgentSwarmOrchestrator  # noqa: E402
from harness.memory.project_memory import ProjectMemory  # noqa: E402


def main() -> int:
    prompt = sys.argv[1] if len(sys.argv) > 1 else ""
    if not prompt.strip():
        print(json.dumps({"ok": False, "error": "prompt argument required"}))
        return 2

    try:
        memory = ProjectMemory()
        orchestrator = AgentSwarmOrchestrator(memory)
        result = orchestrator.execute_swarm_pipeline(prompt)
        print(
            json.dumps(
                {
                    "ok": True,
                    "prompt": prompt,
                    "log": result.get("log", []),
                    "project_status": result.get("project_status", {}),
                    "adrs": memory.list_adrs(),
                    "latest_qa": memory.get_latest_benchmarks(limit=5),
                }
            )
        )
        return 0
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
