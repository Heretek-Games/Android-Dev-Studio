# Playbook: defect-fix — reproduce → minimal probe → fix → gate → commit

Fixes one tracked defect (GitHub issue) with a red→green proof. The worked
example is issue #7 (frame readback returns identical bytes across scenes).

Set once per task:

```bash
WORKTREE=/home/john/Projects/Heretek-Games/worktrees/<track>-<task>
ISSUE=7   # the GitHub issue number being fixed
```

All commands below run with `WORKTREE` as cwd unless noted.

## 1. Reproduce (must fail first — no fix without a red proof)

1.1 Write a minimal reproduction as a real command, not a description.
For renderer/capture defects use the Tier 2 emulator path from AGENTS.md §3:

```bash
python3 harness/build/apk_builder.py --tier2      # export scene -> NDK build -> APK -> install + launch
adb logcat -s HeretekTier2                        # scene/draw telemetry + frame counter
adb exec-out run-as com.heretek.gamestudio.tier2 cat files/native_frame.ppm > /tmp/opencode/frame_before.ppm
```

1.2 Reduce to the smallest probe that distinguishes broken from working.
For #7 the probe is a checksum comparison across two different scenes —
identical bytes across different scenes is the defect signature:

```bash
python3 harness/build/apk_builder.py --tier2 --scene harness/config/scenarios/tide_cinder.json
adb exec-out run-as com.heretek.gamestudio.tier2 cat files/native_frame.ppm > /tmp/opencode/frame_other_scene.ppm
sha256sum /tmp/opencode/frame_before.ppm /tmp/opencode/frame_other_scene.ppm
```

Identical hashes across different scenes ⇒ defect reproduced.
Record both hashes in the defect report — they are the red evidence.

1.3 Headless/engine defects: reproduce with the QA pipeline instead:

```bash
python3 harness/agents/artemis_qa_runner.py --goal "Repro for issue $ISSUE" --scenario harness/config/scenarios/mini_arena.json --frames 600
```

Keep `harness/artemis_report.json` from the failing run (copy it to
`/tmp/opencode/issue-$ISSUE-repro.json` before the next run overwrites it).

## 2. Minimal probe (localize before editing)

- Bisect the suspect path with the smallest observable: for #7 that meant
  checking each stage of the capture chain independently —
  `captureRequested_` flag (`templates/vulkan-container/app/src/main/cpp/vulkan_renderer.cpp`),
  the staging-buffer copy in `recordFrame`
  (`templates/vulkan-container/app/src/main/cpp/vulkan_renderer.cpp`),
  `captureNextFrame` in `templates/vulkan-container/app/src/main/cpp/jni_bridge.cpp`,
  the `nativeCaptureFrame` call in
  `templates/vulkan-container/app/src/main/java/com/heretek/gamestudio/tier2/MainActivity.kt`,
  and finally the pulled `files/native_frame.ppm` bytes.
- Confirm the layer at fault with one measurement per layer (logcat line,
  checksum, decoded pixels). Do not edit until exactly one layer is indicted.
- Shortcut when history allows: bisect with per-step worktrees + QA per step:

```bash
python3 -m harness.loop.regression_bisect --good <rev> --bad <rev> \
  --scenario harness/config/scenarios/mini_arena.json
```

## 3. Fix (smallest diff that turns the probe green)

- Touch only the indicted layer. No drive-by refactors.
- For #7-class capture bugs: fix the staging-buffer/extent handling in
  `templates/vulkan-container/app/src/main/cpp/vulkan_renderer.cpp`, rebuild:

```bash
python3 harness/build/apk_builder.py --tier2
```

- Engine (TS) fixes: rebuild after editing:

```bash
npm --workspace=engine run build
```

## 4. Gate (red→green + no regressions)

4.1 Re-run the exact §1 probe. It must now pass: different scenes ⇒
different checksums; same scene ⇒ decodable, non-uniform PPM. The standing
regression rule is `check_frame_pixels` in `harness/agents/emulator_smoke.py`
(readbacks must decode and show ≥5 unique colors), unit-pinned by
`test_uniform_frame_fails` in `harness/agents/test_emulator_smoke.py`.
Run both:

```bash
python3 harness/agents/emulator_smoke.py --reuse --skip-build  # attached device/emulator + existing APKs
python3 -m unittest harness.agents.test_emulator_smoke
```

4.2 Run the suites for everything touched:

```bash
npm test
python3 -m unittest harness.validation.test_scene_invariants harness.validation.test_quadtree_parity \
  harness.build.test_scene_exporter harness.build.test_apk_builder
```

C++ touched ⇒ also the native host checks:

```bash
cd templates/vulkan-container/app/src/main/cpp && \
  g++ -std=c++17 -Wall -Wextra scene_loader.cpp culling.cpp terrain_mesh.cpp nav_bake.cpp tests/native_scene_test.cpp \
  -o /tmp/native_scene_test && /tmp/native_scene_test ../assets/scene.native
```

QA-scenario-affecting fix ⇒ re-run the scenario green:

```bash
python3 harness/agents/artemis_qa_runner.py --goal "Verify fix for issue $ISSUE" --scenario harness/config/scenarios/mini_arena.json --frames 600
```

4.3 Static-exhaustion rule (the #7 lesson, codified): the defect class must
become a standing automated assertion, not a one-off check. #7 added the
non-uniform-PPM assertion to the smoke gate; your fix must likewise leave a
regression test that fails if the defect returns (headless `.test.ts` for
engine code per Zero Untested Code, Python `test_*.py` for harness code).
No new regression test ⇒ the fix is incomplete.

## 5. Commit (evidence attached, never bare)

```bash
git add <touched files> <new regression test>
git commit -m "fix: <one-line cause + effect> (fixes #<ISSUE>)"
```

Commit message body must contain: the §1 red evidence (hashes / rule
failures), the §4 green evidence (commands + counts), and the regression
test name. If the fix attempt failed, commit the probe + logs anyway as a
`fix attempt (no merge)` record — failed runs are evidence (see
`orchestration/playbooks/merge.md`).

## Gate

RED (§1 probe fails, hashes/rules logged) → GREEN (§4 probe passes +
`touched-area suites green` + new regression test green). Either outcome is
committed; only green proceeds to `merge.md`.

## Evidence format

Defect report in the commit body: `issue # | red hashes-or-rules |
indicted file:line | green hashes-or-rules | regression test | suite counts`.
Long logs go to `harness/runs/RUNS.md` as a new Run Block; reference the
block from the commit body.
