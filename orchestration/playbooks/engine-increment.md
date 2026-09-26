# Playbook: engine-increment — OSINT → ADR → build → headless tests → QA + negative control → commit

Adds or changes engine/runtime capability (TS engine, native container,
harness QA vocabulary). No code before the ADR exists in project memory.

Set once per task:

```bash
WORKTREE=/home/john/Projects/Heretek-Games/worktrees/<track>-<task>
SCENARIO=harness/config/scenarios/mini_arena.json   # scenario proving the increment
```

All commands below run with `WORKTREE` as cwd unless noted.

## 1. OSINT (primary sources only)

- Consult primary sources first: official docs, specs, upstream repos,
  measured benchmarks. No blog-post folklore, no guessed APIs.
- For library/framework questions, pull current docs before deciding:

  `resolve-library-id` then `query-docs` (Context7) for the exact library.
- Record every source URL — the ADR in §2 must cite them.

## 2. ADR in project memory BEFORE code

2.1 Check context first — never design blind:

```bash
python3 -c "from harness.memory.project_memory import ProjectMemory; print(ProjectMemory().query_production_context('<brief-id>'))"
```

(`query_production_context` in `harness/memory/project_memory.py` returns the
brief + ADRs + failed tasks + latest QA. List prior decisions with the
`studio_query_memory` MCP tool or `record_adr`/`get_brief`/`list_briefs` in
`harness/memory/project_memory.py`.)

2.2 Record the ADR via the `studio_record_adr` MCP tool (or `record_adr` in
`harness/memory/project_memory.py` directly). The ADR must contain: the
decision, the alternatives killed, the measured evidence for the choice
(never taste), and the §1 source URLs. Hypothetical example of the required
shape: a Phase-2 language-split decision (e.g. C++20 core + Rust host) could
only be overturned by an ADR with measured evidence — no such ADR exists yet,
so treat this as a shape template, not a citation.

2.3 No code edits until the ADR write is confirmed. A diff without a prior
ADR is rejected at critic review regardless of test results.

## 3. Build

TypeScript engine change:

```bash
npm --workspace=engine run build
```

Native (Tier 2 C++) change — rebuild the container so the edit is real:

```bash
python3 harness/build/apk_builder.py --tier2    # Tier 2 native Vulkan container
```

Tier 1 change:

```bash
python3 harness/build/apk_builder.py            # Tier 1 WebView container
```

## 4. Headless engine tests + QA scenario with negative control

4.1 Add the headless test FIRST for engine logic (Zero Untested Code: every
logic source file has a companion headless `.test.ts`; test files live in
`engine/src/**/*.test.ts` using `node:test` and `node:assert`). Then run:

```bash
npm test
```

Expected baseline: 513 tests / 108 suites green. Your new tests must be
included in that count, all green.

4.2 Prove the increment end-to-end with a QA scenario on the real engine
runtime (Rapier3D + EventSheet + fixed-dt stepping):

```bash
python3 harness/agents/artemis_qa_runner.py --goal "<what the increment proves>" --scenario $SCENARIO --frames 600
```

Verdicts: `SUCCEEDED` / `REGRESSED` (FPS −20%, frame time +20%, draw calls
+25%, heap +30% vs the same-scenario baseline) / `FAILED` (rule assertions).
Report lands in `harness/artemis_report.json`; benchmarks persist to
`harness/project_memory.sqlite` (baselines compare only within the same
scenario — never across scenarios).

4.3 Negative control (mandatory): prove the test can detect the absence of
your increment. `git stash` the fix (keep the test), re-run the scenario,
and confirm the target rule FAILS; then `git stash pop` and confirm it
SUCCEEDS. A test that passes with and without the change proves nothing —
the critic rejects it.

4.4 New QA rule vocabulary (if the increment adds rule types to
`harness/agents/qa_scenario_runner.mjs`): cover each new rule with a passing
case AND a failing case in the scenario spec, mirroring the existing
vocabulary (`entity_exists`, `transform_changes`, `game_score_min`,
`dialogue_reaches`, …). Direct runner for fast iteration:

```bash
node harness/agents/qa_scenario_runner.mjs --scenario $SCENARIO --frames 600 --traverse
```

## 5. Full gates, then commit

```bash
npm test && npm run build
python3 -m unittest harness.validation.test_scene_invariants harness.validation.test_quadtree_parity \
  harness.build.test_scene_exporter harness.build.test_apk_builder
python3 -m unittest discover -s harness/loop -p "test_*.py"
```

C++ touched ⇒ also:

```bash
cd templates/vulkan-container/app/src/main/cpp && \
  g++ -std=c++17 -Wall -Wextra scene_loader.cpp culling.cpp terrain_mesh.cpp tests/native_scene_test.cpp \
  -o /tmp/native_scene_test && /tmp/native_scene_test ../assets/scene.native
```

Then:

```bash
git add <touched files> <new tests> <scenario spec changes>
git commit -m "feat: <increment> (ADR <id>)"
```

Commit body must cite: ADR id, OSINT sources, negative-control result
(fails-without/passes-with), QA verdict + scenario, suite counts.

## Gate

ADR recorded BEFORE first code edit + `npm test` green (incl. new tests) +
QA `SUCCEEDED` on the scenario + negative control demonstrated
(rule FAILS without the change) + full gates green. Missing ADR or missing
negative control ⇒ reject even if everything is green.

## Evidence format

Commit body: `ADR id | sources | negative control (rev + rule + FAILED) |
QA verdict + scenario + frames | suite counts (npm / validation-build /
loop / native)`. `harness/artemis_report.json` output (copy to
`/tmp/opencode/` before the next run overwrites it) + the ADR row in
`harness/project_memory.sqlite` are the audit trail.
