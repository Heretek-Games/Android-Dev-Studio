"""
Regression bisect: find the first commit that broke a QA scenario.

When the loop (or a nightly run) reports a regression, this module binary-searches
the commit range between a known-good and a known-bad revision, running the real
headless QA scenario at each step in a throwaway `git worktree` (with the engine
rebuilt there, since `engine/dist` is a build artifact).

The search is dependency-injected (`rev_list` / `qa_at_commit`) so the unit tests
are hermetic; the CLI wires the real git + Node QA runner.

CLI:
    python3 -m harness.loop.regression_bisect --good <rev> --bad <rev> \\
        --scenario harness/config/scenarios/mini_arena.json
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

RevList = Callable[[str, str], List[str]]
QaAtCommit = Callable[[str], Tuple[bool, str]]


@dataclass
class BisectStep:
    commit: str
    passed: bool
    detail: str


@dataclass
class BisectResult:
    verdict: str  # found | no_regression | indeterminate | error
    first_bad: Optional[str] = None
    steps: List[BisectStep] = field(default_factory=list)
    message: str = ""

    def as_dict(self) -> Dict[str, object]:
        return {
            "verdict": self.verdict,
            "firstBad": self.first_bad,
            "steps": [asdict(step) for step in self.steps],
            "message": self.message,
        }


def find_first_bad(
    good: str,
    bad: str,
    *,
    rev_list: RevList,
    qa_at_commit: QaAtCommit,
    max_steps: int = 24,
) -> BisectResult:
    """Binary-search (good, bad] for the first failing commit."""
    commits = rev_list(good, bad)
    if not commits:
        return BisectResult(
            verdict="error", message=f"no commits in range {good}..{bad}"
        )

    steps: List[BisectStep] = []

    def qa(commit: str) -> bool:
        passed, detail = qa_at_commit(commit)
        steps.append(BisectStep(commit=commit, passed=passed, detail=detail))
        return passed

    # The range's tip is known-bad; verify it so an all-green range is reported honestly.
    if qa(commits[-1]):
        return BisectResult(
            verdict="no_regression",
            steps=steps,
            message=f"QA passes at {bad} — nothing to bisect (range {good}..{bad})",
        )

    lo, hi = 0, len(commits) - 1
    while lo < hi:
        if len(steps) >= max_steps:
            return BisectResult(
                verdict="indeterminate",
                steps=steps,
                message=f"step budget exhausted ({max_steps}) before isolating a single commit",
            )
        mid = (lo + hi) // 2
        if qa(commits[mid]):
            lo = mid + 1
        else:
            hi = mid

    return BisectResult(
        verdict="found",
        first_bad=commits[lo],
        steps=steps,
        message=f"first failing commit: {commits[lo]} ({len(steps)} QA run(s))",
    )


# --------------------------------------------------------------------- real runner
def make_git_qa(
    scenario: Path,
    frames: int = 600,
    repo_root: Path = REPO_ROOT,
    build_engine: bool = True,
) -> Tuple[RevList, QaAtCommit]:
    """Wire the real `git worktree` + engine build + headless QA runner."""
    scenario_rel = scenario.resolve().relative_to(repo_root.resolve())
    cache: Dict[str, Tuple[bool, str]] = {}

    def rev_list(good: str, bad: str) -> List[str]:
        proc = subprocess.run(
            ["git", "rev-list", "--reverse", "--first-parent", f"{good}..{bad}"],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"git rev-list failed: {proc.stderr.strip()[:300]}")
        return [line.strip() for line in proc.stdout.splitlines() if line.strip()]

    def qa_at_commit(commit: str) -> Tuple[bool, str]:
        if commit in cache:
            return cache[commit]
        tmp = Path(tempfile.mkdtemp(prefix="heretek-bisect-"))
        worktree = tmp / "wt"
        try:
            add = subprocess.run(
                ["git", "worktree", "add", "--detach", str(worktree), commit],
                cwd=str(repo_root),
                capture_output=True,
                text=True,
            )
            if add.returncode != 0:
                raise RuntimeError(
                    f"git worktree add failed: {add.stderr.strip()[:300]}"
                )

            if build_engine:
                build = subprocess.run(
                    ["npm", "--workspace=engine", "run", "build"],
                    cwd=str(worktree),
                    capture_output=True,
                    text=True,
                    timeout=300,
                )
                if build.returncode != 0:
                    raise RuntimeError(
                        f"engine build failed at {commit}: {build.stderr.strip()[:300]}"
                    )

            scenario_path = worktree / scenario_rel
            if not scenario_path.exists():
                raise RuntimeError(
                    f"scenario {scenario_rel} does not exist at {commit}"
                )

            qa = subprocess.run(
                [
                    "node",
                    "harness/agents/qa_scenario_runner.mjs",
                    "--scenario",
                    str(scenario_path),
                    "--frames",
                    str(frames),
                ],
                cwd=str(worktree),
                capture_output=True,
                text=True,
                timeout=900,
            )
            if qa.returncode not in (0, 1):
                raise RuntimeError(
                    f"QA runner failed at {commit}: {qa.stderr.strip()[:300]}"
                )
            report = json.loads(qa.stdout)
            failed = [r.get("id") for r in report.get("rules", []) if not r.get("pass")]
            passed = not failed and report.get("verdict") != "FAILED"
            detail = (
                "all rules pass"
                if passed
                else f"failing rules: {', '.join(str(f) for f in failed) or report.get('verdict')}"
            )
            cache[commit] = (passed, detail)
            return cache[commit]
        finally:
            subprocess.run(
                ["git", "worktree", "remove", "--force", str(worktree)],
                cwd=str(repo_root),
                capture_output=True,
                text=True,
            )
            shutil.rmtree(tmp, ignore_errors=True)

    return rev_list, qa_at_commit


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Find the first commit that breaks a QA scenario"
    )
    parser.add_argument("--good", required=True, help="Known-good revision")
    parser.add_argument(
        "--bad", default="HEAD", help="Known-bad revision (default HEAD)"
    )
    parser.add_argument(
        "--scenario", required=True, help="Scenario spec to run at each step"
    )
    parser.add_argument("--frames", type=int, default=600)
    parser.add_argument(
        "--no-engine-build", action="store_true", help="Skip the per-step engine build"
    )
    parser.add_argument("--json", action="store_true", help="Emit the result as JSON")
    args = parser.parse_args()

    try:
        rev_list, qa_at_commit = make_git_qa(
            Path(args.scenario),
            frames=args.frames,
            build_engine=not args.no_engine_build,
        )
        result = find_first_bad(
            args.good, args.bad, rev_list=rev_list, qa_at_commit=qa_at_commit
        )
    except Exception as error:
        result = BisectResult(verdict="error", message=str(error))

    if args.json:
        print(json.dumps(result.as_dict(), indent=2))
    else:
        print(f"verdict: {result.verdict.upper()} — {result.message}")
        for step in result.steps:
            print(
                f"  {'PASS' if step.passed else 'FAIL'} {step.commit[:12]} — {step.detail}"
            )
    return 0 if result.verdict in ("found", "no_regression") else 1


if __name__ == "__main__":
    sys.exit(main())
