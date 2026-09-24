"""
Heretek 3D Android Studio — Persistent Project Memory
SQLite-backed knowledge graph and cross-session ledger preserving
Architectural Decision Records (ADRs), scene snapshots, component schemas,
subagent task DAGs, and Google Artemis QA performance benchmarks.
"""

import sqlite3
import json
import os
import time
from typing import Any, Dict, List, Optional

DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "project_memory.sqlite")

class ProjectMemory:
    def __init__(self, db_path: str = DEFAULT_DB_PATH):
        self.db_path = db_path
        self._memory_conn: Optional[sqlite3.Connection] = None
        if db_path == ":memory:":
            self._memory_conn = sqlite3.connect(":memory:")
            self._memory_conn.row_factory = sqlite3.Row
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self._memory_conn is not None:
            return self._memory_conn
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        """Initializes tables for cross-session persistent storage."""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            # 1. Architectural Decision Records (ADRs)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS adrs (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    rationale TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'accepted',
                    tags TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                )
            """)

            # 2. Scene Graph Snapshots & Component Schemas
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS scene_snapshots (
                    scene_id TEXT PRIMARY KEY,
                    scene_name TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,
                    ast_json TEXT NOT NULL,
                    entity_count INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL
                )
            """)

            # 3. Subagent Task DAG & Execution Ledger
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS subagent_tasks (
                    task_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT,
                    parent_task_id TEXT,
                    assigned_agent TEXT NOT NULL,
                    state TEXT NOT NULL DEFAULT 'pending',
                    dependencies TEXT,
                    result_json TEXT,
                    created_at REAL NOT NULL,
                    completed_at REAL
                )
            """)

            # 4. QA Telemetry & Performance Benchmark History
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS qa_benchmarks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    goal TEXT NOT NULL,
                    device_serial TEXT NOT NULL,
                    fps_average REAL NOT NULL,
                    frame_time_ms REAL NOT NULL,
                    vram_mb REAL NOT NULL,
                    logcat_exceptions INTEGER NOT NULL DEFAULT 0,
                    verdict TEXT NOT NULL,
                    created_at REAL NOT NULL
                )
            """)

            conn.commit()

    # --- ADR Management ---
    def record_adr(self, title: str, rationale: str, status: str = "accepted", tags: Optional[List[str]] = None) -> str:
        adr_id = f"ADR-{int(time.time() * 1000)}"
        now = time.time()
        tags_str = json.dumps(tags or [])
        with self._get_connection() as conn:
            conn.execute(
                "INSERT INTO adrs (id, title, rationale, status, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (adr_id, title, rationale, status, tags_str, now, now)
            )
            conn.commit()
        return adr_id

    def list_adrs(self) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            rows = conn.execute("SELECT * FROM adrs ORDER BY created_at DESC").fetchall()
            return [
                {
                    "id": r["id"],
                    "title": r["title"],
                    "rationale": r["rationale"],
                    "status": r["status"],
                    "tags": json.loads(r["tags"]),
                    "created_at": r["created_at"]
                }
                for r in rows
            ]

    # --- Scene Snapshots ---
    def save_scene_snapshot(self, scene_id: str, scene_name: str, ast: Dict[str, Any]) -> int:
        ast_str = json.dumps(ast)
        entity_count = len(ast.get("gameObjects", []))
        now = time.time()

        with self._get_connection() as conn:
            existing = conn.execute("SELECT version FROM scene_snapshots WHERE scene_id = ?", (scene_id,)).fetchone()
            version = (existing["version"] + 1) if existing else 1

            conn.execute(
                """INSERT OR REPLACE INTO scene_snapshots (scene_id, scene_name, version, ast_json, entity_count, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (scene_id, scene_name, version, ast_str, entity_count, now)
            )
            conn.commit()
        return version

    def get_scene_snapshot(self, scene_id: str) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM scene_snapshots WHERE scene_id = ?", (scene_id,)).fetchone()
            if not row:
                return None
            return {
                "scene_id": row["scene_id"],
                "scene_name": row["scene_name"],
                "version": row["version"],
                "ast": json.loads(row["ast_json"]),
                "entity_count": row["entity_count"],
                "created_at": row["created_at"]
            }

    # --- Subagent Task DAG ---
    def create_task(self, title: str, description: str, assigned_agent: str, dependencies: Optional[List[str]] = None, parent_id: Optional[str] = None) -> str:
        task_id = f"task_{int(time.time() * 1000)}_{os.urandom(2).hex()}"
        now = time.time()
        deps_str = json.dumps(dependencies or [])
        with self._get_connection() as conn:
            conn.execute(
                """INSERT INTO subagent_tasks (task_id, title, description, parent_task_id, assigned_agent, state, dependencies, created_at)
                   VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)""",
                (task_id, title, description, parent_id, assigned_agent, deps_str, now)
            )
            conn.commit()
        return task_id

    def update_task_state(self, task_id: str, state: str, result: Optional[Dict[str, Any]] = None):
        completed_at = time.time() if state in ("completed", "failed") else None
        res_str = json.dumps(result) if result else None
        with self._get_connection() as conn:
            conn.execute(
                "UPDATE subagent_tasks SET state = ?, result_json = ?, completed_at = ? WHERE task_id = ?",
                (state, res_str, completed_at, task_id)
            )
            conn.commit()

    def list_tasks(self, state: Optional[str] = None) -> List[Dict[str, Any]]:
        query = "SELECT * FROM subagent_tasks"
        params = []
        if state:
            query += " WHERE state = ?"
            params.append(state)
        query += " ORDER BY created_at ASC"

        with self._get_connection() as conn:
            rows = conn.execute(query, params).fetchall()
            return [
                {
                    "task_id": r["task_id"],
                    "title": r["title"],
                    "description": r["description"],
                    "assigned_agent": r["assigned_agent"],
                    "state": r["state"],
                    "dependencies": json.loads(r["dependencies"]),
                    "result": json.loads(r["result_json"]) if r["result_json"] else None,
                    "created_at": r["created_at"],
                    "completed_at": r["completed_at"]
                }
                for r in rows
            ]

    # --- QA Benchmarks ---
    def record_qa_benchmark(self, goal: str, device_serial: str, fps: float, frame_time_ms: float, vram_mb: float, exceptions: int, verdict: str):
        now = time.time()
        with self._get_connection() as conn:
            conn.execute(
                """INSERT INTO qa_benchmarks (goal, device_serial, fps_average, frame_time_ms, vram_mb, logcat_exceptions, verdict, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (goal, device_serial, fps, frame_time_ms, vram_mb, exceptions, verdict, now)
            )
            conn.commit()

    def get_latest_benchmarks(self, limit: int = 5) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            rows = conn.execute("SELECT * FROM qa_benchmarks ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
            return [
                {
                    "id": r["id"],
                    "goal": r["goal"],
                    "device_serial": r["device_serial"],
                    "fps_average": r["fps_average"],
                    "frame_time_ms": r["frame_time_ms"],
                    "vram_mb": r["vram_mb"],
                    "logcat_exceptions": r["logcat_exceptions"],
                    "verdict": r["verdict"],
                    "created_at": r["created_at"]
                }
                for r in rows
            ]

    # --- Project Summary ---
    def get_project_summary(self) -> Dict[str, Any]:
        with self._get_connection() as conn:
            adr_count = conn.execute("SELECT COUNT(*) FROM adrs").fetchone()[0]
            scene_count = conn.execute("SELECT COUNT(*) FROM scene_snapshots").fetchone()[0]
            task_pending = conn.execute("SELECT COUNT(*) FROM subagent_tasks WHERE state = 'pending'").fetchone()[0]
            task_completed = conn.execute("SELECT COUNT(*) FROM subagent_tasks WHERE state = 'completed'").fetchone()[0]
            latest_qa = conn.execute("SELECT * FROM qa_benchmarks ORDER BY created_at DESC LIMIT 1").fetchone()

            return {
                "adr_count": adr_count,
                "scene_snapshots": scene_count,
                "tasks": {
                    "pending": task_pending,
                    "completed": task_completed
                },
                "latest_qa": dict(latest_qa) if latest_qa else None
            }
