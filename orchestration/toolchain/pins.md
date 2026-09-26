# Toolchain pins — static quality gates (Phase 0, Node D)

Captured 2026-09-26 on `Fedora Linux 46 (KDE Plasma Desktop Edition
Prerelease)`. Every version below is the verbatim `--version` output of the
binary the hooks invoke. The gates are defined in `/lefthook.yml` (repo
root); missing-binary reporting lives in `install.sh` (this directory).

## Pinned versions

| Tool | Version (verbatim) | Location | Install |
|------|--------------------|----------|---------|
| lefthook | `lefthook version 2.1.11` | `/home/john/go/bin/lefthook` | Go toolchain install (already on PATH via `~/go/bin`) |
| clang-format | `clang-format version 23.1.2 (Fedora 23.1.2-1.fc46)` | `/usr/bin/clang-format` | Fedora package `clang-tools-extra-23.1.2-1.fc46.x86_64` (`sudo dnf install clang-tools-extra`) |
| clang-tidy | `LLVM version 23.1.2` (optimized build; Fedora package `clang-tools-extra-23.1.2-1.fc46.x86_64`) | `/usr/bin/clang-tidy` | Same package as clang-format |
| gitleaks | `8.30.1` | `/home/linuxbrew/.linuxbrew/bin/gitleaks` | `brew install gitleaks` (Linuxbrew 7.0.6) |
| cargo | `cargo 1.95.0 (f2d3ce0bd 2026-03-21)` | rustup/cargo on PATH (`1.95.0`) | rustup (`rustup update`); informational only — no Cargo workspace exists yet |
| rustc | `rustc 1.95.0 (59807616e 2026-04-14)` | same as cargo | same as cargo |
| ruff | `ruff 0.16.1` | `/home/john/.local/bin/ruff` | `pip install --upgrade ruff` / `pipx install ruff` (already on PATH via `~/.local/bin`) |
| mypy | `mypy 2.1.0 (compiled: yes)` | `/home/john/.local/bin/mypy` | `pip install --upgrade mypy` (already on PATH via `~/.local/bin`) |
| python3 | `Python 3.14.7` | PATH-resolved (`/usr/bin/python3` on the pinning machine) | Fedora system Python (any `PATH` python3 at a matching version satisfies the gates) |
| cppcheck | **NOT INSTALLED** | — | see “cppcheck gap” below |

Notes:

- Hooks resolve tools via `PATH`. The locations above are where they were
  found on the pinning machine; any machine with the same (or newer,
  re-verified) versions on `PATH` satisfies the gates. Run `install.sh` to
  check.
- `clang-tidy --version` on Fedora prints only the LLVM version line
  (`LLVM version 23.1.2`); the RPM (`clang-tools-extra-23.1.2-1.fc46.x86_64`)
  is the precise pin.
- Ruff 0.16.x enables the full stable rule set by default (no config file in
  repo), which is why the `ruff-check` hook carries an explicit `--ignore`
  list instead of relying on defaults.
- There is no `Cargo.toml` anywhere in the repo (`find . -name Cargo.toml`
  empty, excluding `node_modules`/`.git`), so the Rust jobs in
  `/lefthook.yml` are a commented stub. Cargo 1.95.0 is pinned here so the
  stub can be activated without a toolchain surprise.
- All repo Python lives under `harness/` (verified: no `*.py` outside
  `harness/`, excluding `node_modules`/`.git`), so the Python hooks scope to
  `harness/**/*.py`.

## The cppcheck gap (and how to close it)

`cppcheck` is not installed and could not be installed in-session:

- `sudo -n true` → fails (no passwordless sudo; no sudo assumptions allowed).
- No `apt-get` on this machine (Fedora 46). `dnf` exists but needs root.
- Linuxbrew 7.0.6 **does** carry a bottle: `cppcheck: stable 2.22.0
  (bottled), HEAD` (`brew info cppcheck`, 2026-09-26) — installable without
  root, but not installed per the no-machine-state-change rule for this node.

Close-out (follow-up owner: whoever picks up the `cppcheck` TODO in
`/lefthook.yml`):

1. `sudo dnf install cppcheck` (needs root) **or** `brew install cppcheck`
   (bottle 2.22.0, no root needed).
2. Run `cppcheck --enable=warning,performance,portability
   templates/vulkan-container/app/src/main/cpp` and triage what fails that
   day (expect Vulkan/JNI include noise — prefer `--inline-suppr` with dated
   comments over command-line `-i`).
3. Record the exact installed version in the table above.
4. Delete the warn-only tail (`|| { ...; true; }` plus the missing-binary
   early-exit) on the `cppcheck` job in `/lefthook.yml` to enforce it.
5. Re-run `lefthook run pre-commit --all-files` green.

The gate is warn-only, never dropped: the `cppcheck` job exists in
`/lefthook.yml` and prints its TODO on every run touching C++ files.

## Gate baselines (verified 2026-09-26, `origin/main` @ `573b17a`)

Enforcing (must stay green):

- `ruff-check` — `ruff check harness/` with the 33-code `--ignore` list in
  `/lefthook.yml` exits 0 (`All checks passed!`). Bare `ruff check
  harness/` reports **1491 errors**; top codes: UP006 x834, UP045 x208,
  UP035 x106, RUF100 x84, PLR1711 x44, RET501 x44, BLE001 x34, F401 x34,
  PLW1510 x27, I001 x15 (full histogram via `ruff check harness/
  --statistics`). Real-bug-class occurrences allowlisted today: F821 x2
  (`harness/loop/aesthetic.py:94,96`), F811 x2
  (`harness/loop/test_action_applier.py:65,101`), B017 x1
  (`harness/memory/test_project_memory.py:64`), F541 x1
  (`harness/mcp_server.py:1723`), PLR1704 x1 (`harness/mcp_server.py:1689`).
- `clang-tidy` — all 9 translation units under
  `templates/vulkan-container/app/src/main/cpp` (incl. `tests/`) pass with
  `--warnings-as-errors='*'` and checks
  `bugprone-*,cert-*,concurrency-*` minus 4 dated exclusions
  (`-bugprone-easily-swappable-parameters`,
  `-bugprone-unchecked-string-to-number-conversion`,
  `-bugprone-implicit-widening-of-multiplication-result`, `-cert-err34-c`);
  0 diagnostics. Headers are analysed transitively via
  `--header-filter='templates/vulkan-container/.*'` (passing `.h` files
  directly makes clang-tidy treat them as C and fail — hence cpp-only TUs).
- `gitleaks` — `gitleaks protect --verbose --redact --staged` exits 0
  (`no leaks found`) on the clean tree.

Warn-only (exit 0, loud TODO, flip to enforcing per the job comments):

- `clang-format` — all 15 C++ files fail default LLVM style (no
  `.clang-format` in repo; adding one is out of this node's file scope).
- `ruff-format` — 5 files fail: `harness/agents/emulator_smoke.py`,
  `harness/agents/stress_scene_gen.py`,
  `harness/agents/test_stress_scene_gen.py`,
  `harness/loop/test_action_applier.py`, `harness/loop/test_vision.py`
  (159 already formatted).
- `mypy-strict` — whole-dir run dies with exit 2 (no `__init__.py`
  anywhere; `project_memory` vs `memory.project_memory` duplicate-module
  error); sampled per-file `--strict` also fails (e.g.
  `harness/agents/device_cli.py:33 [type-arg]`).
- `cppcheck` — see gap section above.

## Re-verification

```bash
lefthook run pre-commit --all-files   # full-tree gate; green or explicitly warn-only
bash orchestration/toolchain/install.sh  # binary presence report
```
