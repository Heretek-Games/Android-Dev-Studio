# Playbook: merge — critic sign-off → rebase → full suites fresh → push

Lands one worktree node onto `main`. No green gate, no merge — the
orchestrator merges strictly one node at a time.

Set once per task:

```bash
WORKTREE=/home/john/Projects/Heretek-Games/worktrees/<track>-<task>
BRANCH=<node-branch>   # the worktree's branch
```

Run rebase/suite commands with `WORKTREE` as cwd.

## 1. Critic sign-off (required, different session)

- Every builder node gets a critic node in a **different session**
  (enforced: critic session ID ≠ builder session ID). Builders never grade
  their own work.
- The critic reviews the diff against the node's acceptance criteria with
  the static-analysis log as mandatory input; an unaddressed warning is a
  review-blocking finding.
- No sign-off wording from a different session ⇒ no merge. A builder
  self-approval is void.

## 2. Rebase worktree onto main (one node at a time)

```bash
git fetch origin
git rebase origin/main
```

- If the rebase conflicts or the scope overlaps an in-flight node, the node
  goes back to `working` with the conflict log attached — never
  force-merged. Overlapping file scopes are sequenced, not parallelized
  (shared touchpoints — barrel exports, `CMakeLists.txt`, scene schemas,
  `AGENTS.md` — belong to the `integrator` role only, as defined in
  `/home/john/.opencode/plan/engine-overhaul.md` §0.3).
- The rebase must be clean (no `--force`, no conflict markers) before §3.

## 3. FULL suites fresh (after the rebase, never before)

Stale pre-rebase greens do not count. Re-run everything on the rebased tree:

```bash
npm test
```

Expected: 513 tests / 108 suites green.

```bash
python3 -m unittest discover -s harness/agents -p "test_*.py"
```

Expected: 65 agent Python tests green.

```bash
python3 -m unittest discover -s harness/loop -p "test_*.py"
```

Expected: 249 loop tests green.

```bash
python3 -m unittest harness.validation.test_scene_invariants harness.validation.test_quadtree_parity \
  harness.build.test_scene_exporter harness.build.test_apk_builder
```

Native host checks (Tier 2 core: loader, culling, terrain meshing,
projection) — 66 checks:

```bash
cd templates/vulkan-container/app/src/main/cpp && \
  g++ -std=c++17 -Wall -Wextra scene_loader.cpp culling.cpp terrain_mesh.cpp nav_bake.cpp tests/native_scene_test.cpp \
  -o /tmp/native_scene_test && /tmp/native_scene_test ../assets/scene.native
```

And the production bundle:

```bash
npm test && npm run build
```

Any red ⇒ node returns to `working` with the failing log attached. The
merge queue moves to the next node; this one waits for a fixed rebase.

## 4. Push (only on §1 + §3 green)

```bash
git push origin $BRANCH
```

Then merge to `main` (merge commit or fast-forward per orchestrator policy)
and delete the worktree:

```bash
git worktree remove $WORKTREE --force
git worktree prune
```

### Post-merge engine-dist rebuild (on main, after the merge lands)

On your `main` checkout after the merge lands, if the node touched
`engine/src/**` and you invoke `npm --workspace=app run build` directly,
run `npm --workspace=engine run build` first — the app typechecks against
local `engine/dist/` (untracked), so a stale dist fails with phantom
`TS2339`s. Root `npm run build` already sequences engine-then-app, so no
extra step there.

## 5. Failed runs committed as evidence

A node that never goes green is still committed on its branch with a
precise defect report (red logs, failing suites, suspected cause) — failed
runs calibrate the next attempt and are never silently dropped. Record the
run as a Run Block in `harness/runs/RUNS.md` (format follows the existing
blocks: goal, per-step telemetry, outcome, suspected cause, fix or
next-step) and reference it from the commit body.

## Gate

Critic sign-off (different session) + clean `rebase onto origin/main` +
FULL suites fresh and green (`npm test` 513/108, agents 65, loop 249,
validation/build, native host checks 66, `npm run build`). One red ⇒ no
merge; failed runs committed as evidence with defect reports. Post-merge:
on `main` after an `engine/src/**` merge, see the §4 rebuild note before
direct app builds.

## Evidence format

Merge record: `node branch | critic session + verdict | rebase base rev |
suite counts (npm 513/108, agents 65, loop 249, native 66, build green) |
push rev`. Failure record: same header + failing logs + RUNS.md block +
suspected cause, committed on the node branch, never merged.
