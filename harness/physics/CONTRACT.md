# Physics Behavior Contract (Track C.4)

The Rapier WASM simulation is the behavioral source of truth. Any native
physics candidate (Jolt, Rapier C-API, or otherwise) must satisfy this
contract before a submodule is even discussed.

## Pinned solver parameters

| Parameter | Value | Notes |
|---|---|---|
| Gravity | `(0, -9.81, 0)` | matches `PhysicsWorld` default |
| Fixed timestep | `1/60 s` | `world.timestep`; never variable dt in QA |
| Rapier version | `@dimforge/rapier3d-compat ^0.14.0` | bump = re-baseline the golden hash |
| Init discipline | literal-only fixtures | no `Math.sin/cos` in fixture init (breaks cross-platform determinism per Rapier docs) |
| Body/creation order | fixed | same values, same construction, same order |

## Golden scenario (`harness/physics/contract.mjs`)

Free-fall box, rolling sphere (literal initial velocity), stacked boxes with
a fixed-step-120 impulse; 600 steps at 1/60. Output: world snapshot MD5 +
final body states.

Current golden hash (this host, re-baseline on Rapier bump):

- `snapshotMd5: 0d45863ed9f608ca680d43a3bea30693` (600 steps, dt 1/60)

## Parity checklist for native candidates

1. Reproduce the golden `snapshotMd5` OR document per-body deviations with root cause (solver iteration counts, contact slop, sleeping thresholds).
2. Same fixtures, same order, same fixed dt — no transcendental init.
3. Sleeping behavior must match (bodies at rest read zero velocity).
4. Impulse-at-fixed-step reproducibility (the step-120 impulse is the determinism canary).
5. Cross-platform story stated up front (Jolt: `CROSS_PLATFORM_DETERMINISTIC`, +8%; Rapier C-API: same determinism domains as WASM).

## Evaluation status

- Jolt (MIT): deterministic design, Godot-Jolt precedent, C bindings exist. **No submodule** — Tier-2 native has no runtime to host it; nativity belongs to C.6.
- Rapier C-API: same determinism domains as the WASM build; candidate for C.6 strangler alongside Jolt.
