# Agent Permission Matrix (`followup-agent-perms`)

Evaluation semantics assumed throughout: **last-match-wins** (later rules
override earlier ones), **default deny** when no rule matches, leading `~`
expanded to `$HOME` (per docs, read/edit resources expand `~`), `*` crossing
path separators. Verified by `/tmp/opencode/perm_matrix.py` — 29/29 cases
match intent, and all six files parse as valid frontmatter.

## What changed (critic nits)

1. **Tester** (`tester.md`): added `shell: /tmp/*` allow (compiled test
   binary), `shell: git rev-parse*` + `shell: git log*` allows (record the
   revision under test), and `subagent: deny`. Everything else shell stays
   denied; edit/write stay denied.
2. **Builder** (`builder.md`): added eight deny-after-allow rules (edit+write
   × `**/index.ts`, `**/CMakeLists.txt`, `**/schema*`, `**/AGENTS.md`) placed
   **after** the worktree allows so last-match-wins excludes integrator
   touchpoints mechanically, not just by prompt text. Reads stay allowed.
3. **Critic / tester / researcher**: added explicit `subagent: deny`
   (defense in depth — none nests legitimately; only orchestrator allows it).
4. **Paths**: all hardcoded `/home/john/...` worktree resources in
   `builder.md` / `integrator.md` replaced with `~/...` forms.
5. **Integrator `AGENTS.md` scope**: broadened from top-level-only
   (`worktrees/*/AGENTS.md`) to `worktrees/**/AGENTS.md` (any depth). Intent
   evidence: the plan (`~/.opencode/plan/engine-overhaul.md` §0.3) and
   `orchestrator.md` both name `AGENTS.md` bare with no path qualifier, and
   all three sibling touchpoint rules are already nested (`**`). Builder
   denies mirror the same scope, so exclusivity is symmetric.

## Matrix (allow/deny per last-match-wins)

| # | Agent | Action | Target | Verdict | Deciding rule |
|---|-------|--------|--------|---------|---------------|
| 1 | builder | edit | own worktree `engine/src/combat/sword.ts` | allow | worktree allow |
| 2 | builder | edit | main checkout (outside worktree) | deny | global deny (no later match) |
| 3 | builder | edit | `engine/src/index.ts` (barrel) | deny | touchpoint deny-after-allow |
| 4 | builder | write | `engine/src/index.ts` (barrel) | deny | touchpoint deny-after-allow |
| 5 | builder | edit | `.../cpp/CMakeLists.txt` | deny | touchpoint deny-after-allow |
| 6 | builder | edit | `harness/config/schema.json` | deny | touchpoint deny-after-allow |
| 7 | builder | edit | worktree-root `AGENTS.md` | deny | touchpoint deny-after-allow |
| 8 | builder | edit | nested `engine/src/combat/AGENTS.md` | deny | broadened `**/AGENTS.md` deny |
| 9 | builder | read | `engine/src/index.ts` | allow | worktree read allow (reads unaffected) |
| 10 | builder | subagent | — | deny | explicit deny (pre-existing) |
| 11 | integrator | edit | `engine/src/index.ts` | allow | touchpoint allow |
| 12 | integrator | edit | nested `AGENTS.md` | allow | broadened `**/AGENTS.md` allow |
| 13 | integrator | edit | `engine/src/combat/sword.ts` (feature code) | deny | global deny (no touchpoint match) |
| 14 | integrator | subagent | — | deny | explicit deny (pre-existing) |
| 15 | tester | shell | `/tmp/native_scene_test <worktree>` | allow | new `/tmp/*` allow |
| 16 | tester | shell | `git log --oneline -5` | allow | new `git log*` allow |
| 17 | tester | shell | `git rev-parse HEAD` | allow | new `git rev-parse*` allow |
| 18 | tester | shell | `npm test` | allow | pre-existing allow |
| 19 | tester | shell | `rm -rf /tmp/x` | deny | global shell deny (no allow match) |
| 20 | tester | shell | `git push origin main` | deny | write-op, matches no allow |
| 21 | tester | edit | any | deny | global deny (pre-existing) |
| 22 | tester | subagent | — | deny | new explicit deny |
| 23 | critic | edit | any | deny | global deny (pre-existing) |
| 24 | critic | shell | `git diff main...HEAD` | allow | broad shell allow (review needs diff/log) |
| 25 | critic | subagent | — | deny | new explicit deny |
| 26 | researcher | shell | any | deny | global deny (pre-existing) |
| 27 | researcher | subagent | — | deny | new explicit deny |
| 28 | orchestrator | subagent | — | allow | pre-existing allow (fans out workers) |
| 29 | orchestrator | edit | any | deny | global deny (never touches code) |

## Caveats

- `**/schema*` is a basename-prefix pattern (case-sensitive): it covers
  `schema.json`-style names but not `*Schema.ts` (e.g. `InspectorSchema.ts`).
  This is inherited verbatim from the pre-existing integrator scope and is
  **symmetric** — builder-deny and integrator-allow miss the same names, so
  no asymmetric hole was introduced. Flag for a future nit if the engine's
  matcher turns out case-insensitive or basename-oriented.
- Shell allows are command-prefix patterns (`npm *`, `/tmp/*`, `git log*`);
  arguments after the prefix are unrestricted (e.g. any path after `/tmp/`,
  any subcommand flags on `git log`). Narrower than full shell, wider than
  a fixed argv list — accepted as proportionate for a test runner.
- Prefix matching is string-based, not argv-aware: a payload chained after an
  allowed prefix with `;`, `&&`, `||`, `$()`, backticks, or a newline (e.g.
  `npm test; <anything>`) still matches the allow rule. Containment assumes
  the agent never chains payloads — the matcher is not a shell parser.
- Critic keeps broad `shell: *` (needs `git diff`/`log` plus linter output
  as mandatory review input); containment comes from edit/write/subagent
  denies.
