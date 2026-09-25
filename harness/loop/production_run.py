"""
Production run: one recursive pass of brief -> DAG -> build loop -> gates -> verdict.

This is the executable form of the recursive production loop:
  1. Plan: mandatory memory retrieval (brief + ADRs + failures + QA baseline)
     plus a builder-critic DAG from the brief's acceptance matrix.
  2. Build/Integrate: delegated to an IterateLoop over a staging scene.
  3. Functional + Performance gates: the loop's invariant gate and QA rules
     (draw-call / FPS rules included).
  4. Experiential gate: the loop's vision critique notes, surfaced per criterion.
  5. Judge: green only when the loop converges AND every acceptance criterion
     is either QA-verified or explicitly assigned to a critic; otherwise FAILED
     with a precise defect report (never false success).
  6. Scope reduction is a first-class output: criteria that cannot be verified
     within budget are listed as scope-reduction candidates, not silently passed.
  7. Memory ingestion: DAG task states updated; the caller records ADRs.

The loop runner is injected so unit tests stay hermetic (no LLM, no engine).
"""

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

LoopFactory = Callable[[str, List[Dict[str, Any]]], Any]


@dataclass
class ProductionVerdict:
    verdict: str  # green | failed | error
    brief_id: str
    brief_title: str
    criteria: List[Dict[str, Any]] = field(default_factory=list)
    scope_reduction_candidates: List[str] = field(default_factory=list)
    defect_report: List[str] = field(default_factory=list)
    loop_verdict: str = ""
    total_tokens: int = 0
    error: Optional[str] = None

    def as_dict(self) -> Dict[str, Any]:
        return {
            "verdict": self.verdict,
            "brief_id": self.brief_id,
            "brief_title": self.brief_title,
            "criteria": self.criteria,
            "scopeReductionCandidates": self.scope_reduction_candidates,
            "defectReport": self.defect_report,
            "loopVerdict": self.loop_verdict,
            "totalTokens": self.total_tokens,
            "error": self.error,
        }


class ProductionRun:
    """One autonomous brief-to-verdict pass over an injected build loop."""

    def __init__(self, memory, swarm, loop_factory: LoopFactory):
        self.memory = memory
        self.swarm = swarm
        self.loop_factory = loop_factory

    def run(self, brief_id: str) -> ProductionVerdict:
        started = time.time()
        try:
            context = self.memory.query_production_context(brief_id)
        except Exception as error:
            return ProductionVerdict(
                verdict="error",
                brief_id=brief_id,
                brief_title="",
                error=str(error)[:300],
            )
        brief = context["brief"]

        # Plan: DAG from the acceptance matrix (persists into the task ledger).
        plan = self.swarm.plan_from_brief(brief_id)
        from harness.orchestrator.agent_swarm import AXIS_POD_ASSIGNMENT

        critic_roles = {critic for _, critic in AXIS_POD_ASSIGNMENT.values()}
        build_tasks = [t for t in plan["tasks"] if t["role"] not in critic_roles]
        critic_tasks = [t for t in plan["tasks"] if t["role"] in critic_roles]

        # Build/Integrate + gates: the loop converges the staging scene and
        # returns per-rule results plus vision notes.
        from harness.briefs.game_brief import GameProductionBrief

        parsed = GameProductionBrief.from_dict(brief)
        rules = parsed.compile_acceptance_rules()
        try:
            loop = self.loop_factory(brief.get("title", brief_id), rules)
            loop_result = loop.run()
        except Exception as error:
            self._mark_all(plan["tasks"], "failed", {"error": str(error)[:300]})
            return ProductionVerdict(
                verdict="error",
                brief_id=brief_id,
                brief_title=parsed.title,
                error=f"build loop failed: {error}"[:300],
            )

        # Judge: map loop rule outcomes back onto acceptance criteria.
        passed_ids = {
            r.get("id")
            for r in (loop_result.final_report or {}).get("rules", [])
            if r.get("pass")
        }
        failed_ids = {
            r.get("id")
            for r in (loop_result.final_report or {}).get("rules", [])
            if not r.get("pass")
        }
        criteria_outcomes = []
        defects = []
        scope_candidates = []
        for criterion in parsed.acceptance:
            has_rule = criterion.qa_rule is not None
            if has_rule and criterion.id in passed_ids:
                state = "verified"
            elif has_rule:
                state = "failed"
                defects.append(
                    f"[{criterion.id}] {criterion.description} — QA rule failed"
                )
            else:
                state = "needs-critic-review"
                scope_candidates.append(criterion.id)
            criteria_outcomes.append(
                {"id": criterion.id, "axis": criterion.axis, "state": state}
            )

        # Memory ingestion: DAG states reflect the judged outcome.
        loop_ok = loop_result.verdict == "green"
        for task in build_tasks:
            self.memory.update_task_state(
                task["id"],
                "completed" if loop_ok else "failed",
                {"loopVerdict": loop_result.verdict},
            )
        for task in critic_tasks:
            self.memory.update_task_state(
                task["id"],
                "completed" if loop_ok else "failed",
                {"loopVerdict": loop_result.verdict},
            )

        verdict = "green" if loop_ok and not defects else "failed"
        if verdict == "failed" and not defects and loop_result.error:
            defects.append(f"build loop error: {loop_result.error}")
        if verdict == "failed" and not defects:
            defects.append(
                f"build loop ended '{loop_result.verdict}' without converging"
            )
        _ = started
        return ProductionVerdict(
            verdict=verdict,
            brief_id=brief_id,
            brief_title=parsed.title,
            criteria=criteria_outcomes,
            scope_reduction_candidates=scope_candidates,
            defect_report=defects,
            loop_verdict=loop_result.verdict,
            total_tokens=int(getattr(loop_result, "total_tokens", 0) or 0),
            error=None if verdict == "green" else (loop_result.error or None),
        )

    def _mark_all(
        self, tasks: List[Dict[str, Any]], state: str, result: Dict[str, Any]
    ) -> None:
        for task in tasks:
            self.memory.update_task_state(task["id"], state, result)
