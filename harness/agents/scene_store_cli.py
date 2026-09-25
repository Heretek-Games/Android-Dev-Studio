#!/usr/bin/env python3
"""
Scene Store CLI — dev-server bridge for the Studio app.

The harness scene file (harness/scenes/active_scene.json) is the single source
of truth. Every write goes through the transactional invariant gate and syncs a
snapshot into project_memory, so app-side edits and MCP/agent edits share the
exact same guardrails.

Usage:
    python3 harness/agents/scene_store_cli.py get              # prints scene JSON
    python3 harness/agents/scene_store_cli.py save < scene.json  # validates + persists
                                                               # prints {"ok": bool, "error": str|null}

Exit codes: 0 on success, 1 on rejected write, 2 on usage error.
"""

import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO_ROOT)

from harness.mcp_server import (  # noqa: E402
    load_active_scene,
    save_active_scene_transactional,
)


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in ("get", "save"):
        print("usage: scene_store_cli.py get|save", file=sys.stderr)
        return 2

    command = sys.argv[1]

    if command == "get":
        print(json.dumps(load_active_scene()))
        return 0

    # save
    try:
        scene = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"Invalid scene JSON: {e}"}))
        return 1

    ok, error = save_active_scene_transactional(scene)
    print(json.dumps({"ok": ok, "error": error}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
