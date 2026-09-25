# AI Harness Feedback Runs — Heretek Studio

Repeatable harness e2e records for the Studio AI Copilot pipeline
(`AIHarnessDock` → `AiHarnessService` → `/api/llm` → `mimotp/mimo-v2.6-flash`).
Format follows the feedback-loop methodology: per-stage transport/parse/apply
telemetry from `window.__HARNESS_TRACE__`, thrash signatures, two rubrics
(game + harness), suspected cause, and the fix that closes the loop.

Telemetry sources (chrome-devtools):
- `window.__HARNESS_TRACE__` / localStorage `harness-trace` — per-call pipeline records
- `window.__STUDIO_DEBUG__` — live scene introspection (transforms, events, play state)
- Console messages + network request status (never dump request headers — API keys live there)

---

## Run Block 1 — 2026-09-24/25, `mimotp/mimo-v2.6-flash` via `https://llm.heretek.one/v1`

**Acceptance prompt (mini arena game):**
"Build a mini arena game: spawn a ground arena plane, a player capsule, 6 tall box
pillars arranged as an obstacle course, 5 gold cylinder coins each with a Timer event
that RotateY to spin, and a warm sunset directional light with high intensity"

### Per-run results

| Run | Trace ID | Outcome | Duration | Tokens (c) | Parse | Apply | Notes |
|-----|----------|---------|----------|------------|-------|-------|-------|
| 1 | tr_df5q4y3 | ✅ llm-success | 25.0s | 1522 | codeblock, 19 actions | 19/19 | Baseline success (pre-fix build) |
| 2 | tr_q6iih0d | ❌ parse-degraded | 21.0s | 1800 (= ceiling) | raw, 0 actions | — | **Truncation cascade** (see below) |
| 3 | tr_3bh66se | ✅ llm-success | 15.9s | 1545 | codeblock, 20 actions | 20/20 | Post token-ceiling fix |
| 4 | tr_z6xxvkg | ✅ llm-success | 369.7s | 1967 | codeblock, 19 actions | 19/19 | Upstream latency stall (6.2 min) |
| 5 | tr_qlazspo | ✅ llm-success | 26.7s | 2008 | codeblock, 21 actions | 21/21 | Final verification run |

### Breakdowns found (localized by stage)

1. **Truncation cascade (run 2) — parse stage.**
   Signature: `completionTokens == max_tokens` (1800), `finish_reason` not recorded
   (pre-fix), parse strategy fell back `codeblock → raw`, `JSON.parse` failed on the
   opening fence backtick. Chain: max_tokens truncation → closing ``` fence missing →
   regex fallback to raw → parse degraded → 0 actions applied.
   **Fixes:** `max_tokens` 1800→4000 (self-heal 1200→2500); `finishReason` recorded in
   transport trace; `extractJson` tolerates unterminated fences; `salvageJson`
   balanced-brace recovery salvages complete actions from truncated payloads
   (parse strategy `salvaged`).

2. **Timer conditions never fired — engine stage (EventSheet).**
   Signature: play-mode transform sampling via `__STUDIO_DEBUG__` showed
   `coin1_rotated: false` while physics was demonstrably ticking (player Y settling
   under Rapier gravity). Root cause: `EventSheet.update()` only accumulated timer
   keys that already existed in the map and `checkCondition` never seeded them, so a
   `Timer` condition read `0 >= interval` forever.
   **Fixes:** lazy timer accumulation in `checkCondition` (regression-tested in
   `engine/src/events/EventSheet.test.ts` — 5 new tests, 25/25 green); `RotateY`
   now honors `{degrees}` per-fire steps (Timer/OnStart) alongside `{speed}` rad/s
   (EveryFrame); harness forwards `condition_params`; system prompt documents the
   condition/action param vocabulary.

3. **Upstream latency stall (run 4) — transport stage.**
   Signature: POST `/api/llm/chat/completions` pending 5+ min, UI spinner hung.
   Resolution: completed after 369.7s with HTTP 200 and a clean parse — pure
   upstream slowness. **Fix:** 90s `AbortController` bound on the fetch so hangs
   degrade into a traceable transport error (`timeout after 90s`) instead of an
   infinite spinner.

4. **Silent-failure masking (pre-existing, first pass of this cycle).**
   Signature: fetch errors, parse failures, and action-apply crashes all surfaced as
   plausible chat summaries with green checkmarks (fallback spawned a single
   "Procedural AI Entity"; parse failure produced a fake summary; apply crashes were
   mislabeled "LLM fetch failed"). **Fixes:** `isFallback` + outcome badges
   (Fallback / Parse Degraded / Partial Apply), per-action try/catch with
   target-missing/invalid/error outcomes, `outcome` ∈ llm-success | parse-degraded |
   apply-error | fallback | transport-error on every trace record.

5. **AI Copilot dock unreachable — app wiring (discovered this cycle).**
   `AIHarnessDock` was never registered in DockviewWorkspace (dead code); the
   "Agent Swarm" dispatch is a canned setTimeout simulation, not an LLM pipeline.
   **Fix:** registered `ai_harness` panel in the default bottom drawer + Panels menu.

### Two rubrics

**Game (run 5, accepted):** ground arena ✅, player capsule ✅, 6 pillar obstacle
course ✅, 5 gold coins ✅, Timer→RotateY spin events firing ✅ (rotation.y +3.5 rad
over 3s live-sampled), sunset directional lighting ✅, physics settling ✅ (pillars
tilt under Rapier), mobile HUD + joystick ✅, 60 FPS ✅, zero console errors ✅.
Play-mode proof: `docs/screenshots/qa_run_play_mode.png`.

**Harness:** 4/5 runs `llm-success`; all 5 calls traced end-to-end; every breakdown
localized to a stage (parse ×1, engine ×1, transport ×1) and closed with a fix +
regression coverage; 0 silent degradations post-fix (fallback/degraded states now
explicitly flagged in UI and trace).

### Open items / next run notes

- `AgentSwarmDock.handleDispatchSwarm` remains a canned simulation — wire it to
  `AiHarnessService.generateWorld` (or MCP) so the swarm dock exercises the real
  pipeline.
- RotateY `{degrees}`-per-fire vs `{speed}`-per-frame semantics are now documented
  in the system prompt; consider validating LLM param shapes against the EventSheet
  vocabulary and rejecting malformed params into `apply` outcomes.
- Full-viewport chrome-devtools screenshots can carry stale compositor raster tiles
  (DOM correct, pixels stale; element-uid captures render correctly). Prefer
  `__STUDIO_DEBUG__` DOM assertions + uid element captures for pixel-level checks.
- Upstream latency variance is large (16s–370s). If stalls repeat, raise the 90s
  abort or add retry-with-backoff and record attempts in the trace.
