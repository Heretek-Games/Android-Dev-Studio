# Tier 2 bundled Vulkan validation layers (debug-layers builds only)

`apk_builder.py --tier2 --debug-layers` stages
`libVkLayer_khronos_validation.so` here (one per ABI in `VALIDATION_LAYER_ABIS`)
at build time. The Android loader picks up app-bundled layers automatically —
no manifest needed. The staged `.so` files are build artifacts and are
**never committed** (see `.gitignore` in this directory).

- Provenance: Khronos `Vulkan-ValidationLayers` release
  `vulkan-sdk-1.4.357.0`, asset `android-binaries-1.4.357.0.zip`
  (built with NDK 27.3.13750724; requires API 26+).
- No checksums are published for that asset (verified 2026-09-26); the builder
  verifies integrity structurally (every staged ABI must contain the expected
  library) after download. Downloads are cached under
  `harness/build/tier2-build/.layer-cache/` — inside the root-`.gitignore`d
  tier2-build dir, so the cache never shows up as untracked; override per-run
  with `HERETEK_VALIDATION_LAYER_CACHE`. Corrupt caches are deleted and
  re-downloaded (3 attempts, 60 s timeout each).
- `--dry-run` skips download/staging entirely; plain Release builds pass
  `-DHERETEK_FORCE_VALIDATION_LAYERS=OFF` explicitly (the reused CMake cache
  would otherwise leak a previous ON) and delete any stale staged `.so` files
  so a Release APK can never silently bundle layers.
- Release builds never touch this directory otherwise: the layer lookup stays
  compiled out unless `HERETEK_FORCE_VALIDATION_LAYERS=ON` is set.
