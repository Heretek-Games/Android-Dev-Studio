# Tide and Cinder — Human Playtest & Feel Review (E.2 / E.6 gates)

The machine side is green (engine 513/108, agents 65, loop 249; QA 16/16 on
`tide_cinder`). These two gates require **human judgment with logged evidence**
(charter §6: VLM/builder judgment never counts for feel/fun).

## Setup (5 minutes)

```bash
cd /home/john/Projects/Android-Dev-Studio
npm run dev          # serves http://localhost:3000
```

Open `http://localhost:3000/?play=tide` (desktop: click; touch: tap).
Or header **Tide** in the studio. No build step needed.

Controls: move stick (touch) / WASD (desktop), **⚔ attack** (or Space),
**⇄ swap hero** (mid-fight, 1s cooldown), Esc pauses.

## Part A — E.2 feel review (~10 minutes)

Play through Wave 1 twice: once careless (no blessing), once blessed.

| # | Feel question | Where to look | Verdict (pass/fail + note) |
|---|---|---|---|
| 1 | Swings connect when they look like they should | Blade range 3.5, arc 120°; soft lock-on faces nearest | |
| 2 | Vaporize reads: flash + amplified damage obvious | First Hydro hit on a Pyro slime (one-shots 60 HP) | |
| 3 | Cinder Tyrant wind-up is readable before the strike | Boss flashes dark red 0.6s pre-strike (Wave 2) | |
| 4 | Swap feels responsive, camera follows the lead | ⇄ button; cooldown 1s | |
| 5 | Damage taken feels fair (telegraphed, avoidable by range) | Boss strike 8 @ 4m; slime contact 6 / 2s | |
| 6 | Difficulty: a first-time reader survives Wave 1 | 140 HP hero, respite +40/wave, Squire rotation | |

Log verdicts as a comment on this file's commit or chat them back with
timestamps. Any **fail** becomes a tuning defect (commit the run notes as
evidence — failed feel runs calibrate combat).

## Part B — E.6 full playthrough (~5 minutes)

Script: Start → take the Hydro blessing → clear 2 slimes → swap-aware
Tyrant kill (3 infused swings; expect re-pulsed auras to keep reacting) →
Victory screen shows **quest 5/5**. Green = Victory + quest complete.
Known-good reference: 61.4s agent-driven victory (chrome-devtools, zero
console errors, Run Block 30 notes in `harness/runs/RUNS.md`).

## Part C — On-device (when hardware is attached)

```bash
adb devices  # must list a device (issues #1/#3 block otherwise)
python3 harness/build/apk_builder.py --play tide            # Tier-1 title
python3 harness/build/apk_builder.py --tier2 --scene harness/config/scenarios/tide_cinder.json
```

Play the run on-device; log FPS feel + any ANR/crash with `adb logcat`.
Emulator results never substitute (charter §6).

## Machine pre-checks (already green, re-run on suspicion)

```bash
npm test   # 513/108
python3 -m unittest discover -s harness/agents -p "test_*.py"   # 65
node harness/agents/qa_scenario_runner.mjs \
  --scenario harness/config/scenarios/tide_cinder.json --frames 600 --traverse
```
