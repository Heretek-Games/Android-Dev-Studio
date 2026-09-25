# ADR-0001: Tier 2 Delivery Strategy — World Renderer, Per-Title Adoption

- **Status:** accepted
- **Date:** 2026-09-25
- **Tags:** tier2, vulkan, containers, rendering, strategy
- **Supersedes:** none
- **Related:** GitHub issues #1, #2, #3, #6

## Context

The studio ships two Android containers from one canonical scene
(`harness/scenes/active_scene.json`):

| | Tier 1 — WebView container | Tier 2 — native Vulkan container |
|---|---|---|
| Runtime | Hardware-accelerated WebView + WebGL2 (three.js) | `libheretek_native.so` + Vulkan |
| On-device status | Renders the full studio + generated games; deploy E2E verified | Renders terrain (64 LOD leaves) + instanced cubes at ~61.5 FPS; real swapchain, frame readback verified |
| Feature level | Full engine feature set (materials, lighting, cel shading, foliage, UI overlays) | Flat vertex colors; no textures, lighting model, shadows, skinning, or UI layer |
| Draw-call path | Per-mesh draws with batching/LOD; 23 draws for the mini arena | One indirect draw per batch + one for all terrain leaves; scales to 50k instances (host-tested) |
| UI/HUD | HTML/CSS (studio UI already renders in the WebView) | None (SurfaceView only) |

Evidence: `harness/runs/RUNS.md` (Run Block 2), commit `4a7107e`, `templates/vulkan-container/README.md`.

Two facts drive this decision:

1. **Tier 1 already ships.** It renders the studio and harness-generated games on-device today,
   with the engine's full feature set and an HTML UI layer for free.
2. **Tier 2's advantage is scale, not features.** Its measured win is the low-draw-call
   indirect path (host-verified at 50k instances); its missing features are exactly the ones
   Tier 1 gets from the web stack (materials, lighting, UI).

## Options considered

**A. Full native parity push** — implement textures/materials, lighting, shadows, skinning,
and a native UI layer in the Vulkan renderer.
*Pros:* single high-performance path, no WebView overhead.
*Cons:* months of feature work duplicating what the web stack already provides; UI toolkits in
Vulkan are a large, low-differentiation investment; the studio's authoring loop is HTML-based.

**B. Hybrid, per-title adoption (chosen)** — Tier 2 is the **world renderer** for titles whose
draw-call/FPS budgets cannot be met in Tier 1; UI/HUD/menus stay in the WebView layer in both
tiers. Tier 1 remains the default shipping path.
*Pros:* invests native effort where it pays off (terrain, instancing, culling); avoids
reimplementing UI/materials; both tiers share one scene export (cross-tier quadtree parity is
already regression-gated); per-title opt-in keeps risk contained.
*Cons:* two render paths to maintain; a hybrid title must composite a Vulkan SurfaceView with a
WebView overlay and route input across them (known Android pattern, but real integration work).

**C. Research park** — freeze Tier 2 except for hardening; never ship it.
*Pros:* zero further investment.
*Cons:* discards the only path to 50k-instance/terrain-scale titles; the container would drift
without even validation.

## Decision

Adopt **Option B**. Concretely:

1. **Tier 1 (WebView) is the default delivery target** for every game the harness produces until
   a title demonstrably exceeds its budgets.
2. **Tier 2 is the performance tier**, scoped to world rendering: terrain LOD, instanced draws,
   compute culling, and the scene/telemetry bridge. It is adopted **per title** when Tier 1 cannot
   hold 60 FPS within the 100-draw mobile budget.
3. **UI/HUD/menus are not implemented natively.** When a title adopts Tier 2, its UI is rendered
   by a WebView overlay layer above the Vulkan SurfaceView (or by native Android views for simple
   HUDs). This is the "hybrid" part of the strategy.
4. **Full native parity (textures/lighting/shadows/skinning) is deferred, not abandoned.** It is
   revisited only when a shipped Tier 2 title needs a feature that cannot be delivered through the
   hybrid split.

## Consequences

- Tier 2's roadmap prioritizes **hardening and validation** over features:
  physical-device validation (#1), renderer hardening (#6), 50k-instance on-device validation (#3),
  terrain visual polish (#2). Terrain polish stays in scope because terrain is Tier 2's core value.
- The hybrid split means **no native UI toolkit work** in the near term; the studio's HTML authoring
  loop stays authoritative.
- A future hybrid title needs a documented integration recipe (SurfaceView + WebView compositing,
  input routing, lifecycle). That recipe is a prerequisite for the first Tier 2 adoption and will be
  written when such a title is scoped.
- Cross-tier consistency remains enforced by the existing quadtree parity test; any new exported
  scene data must extend that parity suite.

## Follow-ups

| Item | Issue |
|------|-------|
| Validate Tier 2 on physical arm64 hardware | #1 |
| Terrain visual polish (LOD seams, biome splatting, native foliage wind) | #2 |
| On-device validation of the 50k-instance compute culling path | #3 |
| Renderer hardening (per-frame semaphores, swapchain recreation, validation layers) | #6 |
| (new, when scoped) Hybrid compositing recipe: SurfaceView + WebView UI + input routing | — |
