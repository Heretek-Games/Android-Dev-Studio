#!/usr/bin/env bash
# Heretek Engine toolchain check — static quality gates (Phase 0, Node D).
#
# Idempotent installer STUB: checks every binary the lefthook gates need and
# REPORTS missing ones. It never installs anything and never assumes sudo.
# Safe to re-run any number of times (read-only: `command -v` + `--version`).
#
# Usage: bash orchestration/toolchain/install.sh
# Exit 0 when every ENFORCING-gate binary is present (cppcheck may still WARN
#   and cargo/rustc are informational only — see below; note clang-format is
#   presence-checked here although its lefthook job is warn-only); exit 1
#   when an enforcing binary is missing.
#
# Exact pins: orchestration/toolchain/pins.md. Gates: lefthook.yml.

set -u

FAIL=0          # missing ENFORCING binary -> exit 1
WARN=0          # missing WARN-ONLY/optional binary -> reported, exit stays 0

have() { command -v "$1" >/dev/null 2>&1; }

# $1=label $2=binary $3=mode(enforcing|warn|info) $4...=version args
check() {
  local label="$1" bin="$2" mode="$3"; shift 3
  if have "$bin"; then
    local ver="(version query failed)"
    ver="$("$bin" "$@" 2>&1 | head -3 | tr '\n' ' ')" || true
    printf 'OK    %-14s %-10s %s\n' "$label" "($bin)" "$ver"
    printf '      found at: %s\n' "$(command -v "$bin")"
  else
    case "$mode" in
      enforcing)
        printf 'FAIL  %-14s binary "%s" NOT FOUND on PATH (required by an enforcing gate)\n' "$label" "$bin"
        FAIL=1
        ;;
      warn)
        printf 'WARN  %-14s binary "%s" NOT FOUND on PATH (warn-only gate; TODO dated 2026-09-26 in lefthook.yml)\n' "$label" "$bin"
        WARN=1
        ;;
      info)
        printf 'INFO  %-14s binary "%s" not found (informational only)\n' "$label" "$bin"
        ;;
    esac
  fi
}

echo "== Heretek quality-gate toolchain check =="
echo
echo "-- enforcing-gate binaries (missing => exit 1) --"
check "lefthook"      lefthook      enforcing version
check "clang-format"  clang-format  enforcing --version
check "clang-tidy"    clang-tidy    enforcing --version
check "gitleaks"      gitleaks      enforcing version
check "ruff"          ruff          enforcing --version
check "mypy"          mypy          enforcing --version
check "python3"       python3       enforcing --version
echo
echo "-- warn-only / optional binaries --"
check "cppcheck"      cppcheck      warn      --version
check "cargo"         cargo         info      --version
check "rustc"         rustc         info      --version
echo
echo "-- privilege / package-manager detection (report only, no sudo attempted) --"
if sudo -n true 2>/dev/null; then
  echo "INFO  passwordless sudo: AVAILABLE"
else
  echo "INFO  passwordless sudo: NOT available (no sudo assumptions made)"
fi
for mgr in apt-get dnf yum brew; do
  if have "$mgr"; then echo "INFO  package manager present: $mgr"; else echo "INFO  package manager absent:  $mgr"; fi
done
echo
echo "-- suggested installs for anything missing (run by hand) --"
echo "  Fedora (needs root):  sudo dnf install clang-tools-extra cppcheck"
echo "  Linuxbrew (no root):  brew install gitleaks cppcheck"
echo "  Python (no root):     pip install --upgrade ruff mypy   (~/.local/bin must be on PATH)"
echo "  Rust (no root):       rustup update                     (only needed once a Cargo workspace exists)"
echo "  lefthook:             go install github.com/evilmartians/lefthook@latest  (or package manager)"
echo

if [ "$FAIL" -ne 0 ]; then
  echo "RESULT: FAIL — install the binaries marked FAIL above, then re-run this script."
  exit 1
fi
if [ "$WARN" -ne 0 ]; then
  echo "RESULT: OK (with warnings) — enforcing gates runnable; WARN items track dated TODOs in lefthook.yml."
  exit 0
fi
echo "RESULT: OK — all toolchain binaries present."
exit 0
