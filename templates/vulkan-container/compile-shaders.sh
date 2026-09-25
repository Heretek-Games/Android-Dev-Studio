#!/usr/bin/env bash
# Compiles the Tier 2 shaders to SPIR-V using the NDK's bundled glslc.
# Outputs land in app/src/main/assets/shaders/ (committed so Gradle builds do
# not require glslc at build time).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NDK="${ANDROID_HOME:-$HOME/Android/Sdk}/ndk"
GLSLC="$(find "$NDK" -maxdepth 4 -path '*shader-tools*' -name glslc 2>/dev/null | sort | tail -1)"

if [[ -z "$GLSLC" || ! -x "$GLSLC" ]]; then
  echo "error: glslc not found under $NDK (install the NDK or set ANDROID_HOME)" >&2
  exit 2
fi

SRC="$SCRIPT_DIR/app/src/main/shaders"
OUT="$SCRIPT_DIR/app/src/main/assets/shaders"
mkdir -p "$OUT"

"$GLSLC" "$SRC/cull.comp" -o "$OUT/cull.comp.spv"
"$GLSLC" "$SRC/scene.vert" -o "$OUT/scene.vert.spv"
"$GLSLC" "$SRC/scene.frag" -o "$OUT/scene.frag.spv"
"$GLSLC" "$SRC/terrain.vert" -o "$OUT/terrain.vert.spv"

echo "Compiled 4 shaders to $OUT using $GLSLC"
