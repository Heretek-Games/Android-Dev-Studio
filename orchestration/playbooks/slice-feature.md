# Playbook: slice-feature — GameView wiring → app build → chrome-devtools live proof → commit

Adds or changes a playable slice (`?play=`) or its GameView wiring, proven
live in the browser with zero console errors — never by code inspection.

Set once per task:

```bash
WORKTREE=/home/john/Projects/Heretek-Games/worktrees/<track>-<task>
SLICE=tide   # 1 | driving | dungeon | city | tide
```

Slice URLs and studio headers: `?play=1` (header **Game**, arena run),
`?play=driving` (header **Drive**), `?play=dungeon` (header **Dungeon**),
`?play=city` (header **City**), `?play=tide` (header **Tide**).
Slice boot reads the query param in `app/src/components/GameView.tsx`
(`new URLSearchParams(window.location.search).get('play')`); the live debug
surface is `window.__GAME_DEBUG__` (same file: `phase`, `score`, `kills`,
`wave`, `quest`, `melee`, `party`, `swing`, `dodge`, `swap`, `vehicle`, …).

## 1. GameView wiring

- Implement the slice wiring in `app/src/components/GameView.tsx` (boot
  path, HUD, input, reset). Reuse the centralized slice-reset path — do not
  add per-slice hand-rolled resets.
- Expose every machine-checkable state the proof needs through
  `window.__GAME_DEBUG__` (phase/score/kills/wave/quest/melee/party/…).
  If the proof needs a value that isn't exposed, add the accessor first —
  scraping DOM text is not a substitute.

## 2. App build (must be green before any browser proof)

```bash
npm --workspace=app run build
```

A red production build ⇒ stop. No dev-server-only fixes; the shipped
bundle is the Tier 1 artifact (`apk_builder --play tide` boots straight
into the game from this bundle).

## 3. chrome-devtools live proof (mandatory, in order)

3.1 Start the dev server and open the slice:

```bash
npm run dev
# Server runs at: http://localhost:3000
```

- `navigate_page` to `http://localhost:3000/?play=$SLICE`.
- Assert the boot state via `__GAME_DEBUG__` (e.g. tide: `phase()` menu →
  start → playing; dungeon: `dialogueNode()` reached; city: `settlement()`
  snapshot; driving: `vehicle()` telemetry).

3.2 Drive the slice through `__GAME_DEBUG__` to its verdict state:

| Slice | Drive to | Green condition |
|---|---|---|
| `1` (Game) | waves → win/lose → restart | Victory 200 points (or defeat path + restart) |
| `driving` (Drive) | auto-cruise sprint | Victory 120.7 m, all wheels grounded |
| `dungeon` (Dungeon) | keeper dialogue → blessing → waves | Victory 200 points, 2 kills, Vaporize reactions |
| `city` (City) | click plots → grow | Victory Pop target (3/3 placements) |
| `tide` (Tide) | blessing → melee waves → Tyrant → quest 5/5 | Victory + quest complete (known-good: 61.4s agent-driven victory) |

Use the slice's debug accessors (`swing()`, `swap()`, `dodge()`,
`quest()`, `melee()`, `party()`) to advance and sample state; `click` only
for UI flows a player really clicks (menu buttons, plots, dialogue
choices).

3.3 Zero console errors:

- `list_console_messages` — verify zero WebGL or runtime uncaught
  exceptions across the whole run (boot → verdict → restart).
- Any error ⇒ fix, rebuild (`npm --workspace=app run build`), re-proof
  from §3.1. Console-error-free is part of the gate, not advisory.

3.4 Screenshot the verdict:

- `take_screenshot` at the victory/defeat screen (and one mid-run gameplay
  frame for feel features). Save under `/tmp/opencode/` and note the path
  in the commit body.

## 4. Commit

```bash
git add <touched files>
git commit -m "feat(slice): <slice change> (?play=$SLICE)"
```

Commit body must contain: slice URL, `__GAME_DEBUG__` verdict readings
(phase/score/questavelues), `list_console_messages` result (zero errors),
screenshot path(s), and the `npm --workspace=app run build` result.

Human-feel changes (timing, damage, camera, readability of telegraphs)
also need the PLAYTEST.md human gate — machine proof never counts for
feel/fun. Flag it in the commit body; do not self-pass it.

## Gate

`npm --workspace=app run build` green + live boot at `?play=$SLICE` +
driven to verdict via `__GAME_DEBUG__` + `list_console_messages` zero
errors + `take_screenshot` evidence. Code-only or dev-server-only proof ⇒
reject.

## Evidence format

Commit body: `slice URL | verdict readings (phase/score/kills/quest) |
console messages: 0 errors | screenshots: paths | app build: green`.
Screenshots in `/tmp/opencode/` (paths logged); feel items flagged for the
PLAYTEST.md human gate.
