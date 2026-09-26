/**
 * sceneGraphCanonical — canonical static scene-graph form shared by the
 * Phase 1 parity invariant (HarnessSceneAdapter ≡ qa_scenario_runner).
 *
 * Canonical form (per object, sorted by object name):
 *   { name, components: [sorted constructor names],
 *     transform: { position: [x, y, z], rotation: [x, y, z] },
 *     params: { [componentType]: normalizedParamObject } }
 *
 * It captures the STATIC build output only — object identity, attached
 * component types, transforms, and build-time parameters — never runtime
 * state (health changes, quest stages, spawned waves, ammo, AI telemetry).
 *
 * NORMALIZED PARAMETER SUBSET (both builders preserve these verbatim, or via
 * the single documented rule below):
 *   transform        position/rotation — both builders setPosition/setRotation
 *                      from the spec verbatim.
 *   MeshRenderer     shape/size/color verbatim.
 *   Collider3D       size verbatim; shape via normalizeColliderShape
 *                      (plane|torus → box, see below).
 *   RigidBody3D      bodyType/mass verbatim.
 *   LightComponent   lightType (its `lightType` field)/color/intensity verbatim.
 *   MobileController presence only — see exclusion (a).
 *   WeaponController damage/fireRate/range/maxAmmo (both builders pass the
 *                      weapon config object through verbatim).
 *   HealthComponent  maxHealth/health/destroyOnDeath (verbatim pass-through).
 *   EnemyAI          targetName/moveSpeed/attackDamage (verbatim pass-through).
 *   VehicleController throttle/steering/brake + wheel count (both builders
 *                      construct VehicleController from the same config, then
 *                      apply the same throttle/steering/brake overrides).
 *   ElementalReactionComponent aura (= innateElement)/maxHealth/health (both
 *                      builders take the Track E.6 baseElement path).
 *   EventSheet       per-event { id, conditions: [types], actions: [types] } —
 *                      NORMALIZED because the runner injects id/name/enabled
 *                      defaults and condition/action fallbacks while the
 *                      adapter stores the raw spec array; the condition/action
 *                      TYPE sequences are preserved verbatim by both sides.
 *   DayNightCycle    dayLengthSeconds/timeOfDay — the runner passes the whole
 *                      daynight object (including sun/ambient NAME strings)
 *                      but the DayNightCycle constructor reads only these two
 *                      fields, exactly what the adapter passes. Extra keys are
 *                      constructor-ignored on both sides, not a divergence.
 *   unknown types    presence only ({}) — locked by `components`; params are
 *                      best-effort so a future shared component cannot silently
 *                      widen the invariant without a canonicalizer update.
 *
 * THE ONE VALUE-LEVEL NORMALIZATION — normalizeColliderShape:
 *   The adapter remaps plane|torus collider shapes to box
 *   (HarnessSceneAdapter.ts: `obj.shape === 'plane' || obj.shape === 'torus'`),
 *   while the runner passes the shape verbatim. This is an honest engine
 *   constraint, not a semantic fork: ColliderShape is
 *   'box'|'sphere'|'capsule'|'cylinder' (no plane/torus), and the Rapier init
 *   switch resolves any unknown shape to the box cuboid — so both builds
 *   simulate identical box-cuboid physics. The canonicalizer applies the
 *   adapter's remap to BOTH sides before comparing and the parity probe spec
 *   carries a plane-shaped slab to lock the rule in.
 *
 * DOCUMENTED EXCLUSIONS (known divergences — never silently ignored):
 *   (a) MeshRenderer roughness/metalness: the runner honors
 *       objSpec.roughness and objSpec.metallic|metalness (defaults 0.4/0.0);
 *       the adapter hardcodes roughness 0.4 and omits metalness entirely, so
 *       its builds keep the engine default metalness 0.1 — diverging from the
 *       runner even when the spec sets NOTHING. Excluded; parity specs must
 *       not set roughness/metallic/metalness (enforced by
 *       test_parity_specs_use_shared_vocabulary).
 *   (b) MobileController moveSpeed/rotationSpeed/jumpForce/deadzone: the
 *       runner honors objSpec.controllerOptions; the adapter always builds a
 *       default MobileController(). Excluded; parity specs must not set
 *       controllerOptions (same enforcement).
 *   (c) Transform scale: the adapter applies objSpec.scale, the runner
 *       ignores it (no setScale call in buildScene). Excluded from
 *       `transform`; parity specs must not set scale (same enforcement).
 *
 * Structural typing (no engine import) keeps this usable from plain Node
 * dump scripts as well as studio docks. Both dump scripts
 * (dumpRunnerGraph.mjs, dumpAdapterGraph.ts) import THIS module — the single
 * canonicalizer — so the form cannot drift between dumpers.
 */

export interface CanonicalGraphNode {
  name: string;
  components: string[];
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
  };
  params: Record<string, Record<string, unknown>>;
}

interface GraphLike {
  gameObjects: Array<{
    name: string;
    transform?: {
      position?: { x?: unknown; y?: unknown; z?: unknown } | unknown;
      rotation?: { x?: unknown; y?: unknown; z?: unknown } | unknown;
    } | null;
    components: Array<{ constructor: { name: string } } & Record<string, unknown>>;
  }>;
}

/**
 * Collider-shape normalization shared by the parity invariant.
 * Mirrors the adapter's engine-constraint remap
 * (HarnessSceneAdapter buildEngineScene: plane|torus → box): the engine
 * ColliderShape has no plane/torus and the Rapier init switch falls unknown
 * shapes through to the box cuboid, so both builders simulate identical
 * box-cuboid physics for these shapes.
 */
export function normalizeColliderShape(shape: unknown): string {
  return shape === 'plane' || shape === 'torus' ? 'box' : asString(shape, 'box');
}

/** Finite number or fallback, quantized to 1e-6 (kills float formatting noise). */
function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.round(n * 1e6) / 1e6;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** [x, y, z] triple from a THREE-style {x,y,z} object or a spec-style array. */
function asTriple(
  value: unknown,
  fallback: [number, number, number]
): [number, number, number] {
  if (Array.isArray(value) && value.length >= 3) {
    return [asNumber(value[0], fallback[0]), asNumber(value[1], fallback[1]), asNumber(value[2], fallback[2])];
  }
  if (value && typeof value === 'object') {
    const o = value as { x?: unknown; y?: unknown; z?: unknown };
    if (typeof o.x === 'number' && typeof o.y === 'number' && typeof o.z === 'number') {
      return [asNumber(o.x, fallback[0]), asNumber(o.y, fallback[1]), asNumber(o.z, fallback[2])];
    }
  }
  return [...fallback] as [number, number, number];
}

function conditionActionTypes(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((entry) => {
    if (entry && typeof entry === 'object') return asString((entry as { type?: unknown }).type, '?');
    return '?';
  });
}

/** Normalized build-time parameters for one component instance. */
function componentParams(type: string, c: Record<string, unknown>): Record<string, unknown> {
  switch (type) {
    case 'MeshRenderer':
      // roughness/metalness EXCLUDED — see header exclusion (a).
      return {
        shape: asString(c.shape, 'box'),
        size: asTriple(c.size, [1, 1, 1]),
        color: asString(c.color)
      };
    case 'Collider3D':
      return {
        shape: normalizeColliderShape(c.shape),
        size: asTriple(c.size, [1, 1, 1])
      };
    case 'RigidBody3D':
      return { bodyType: asString(c.bodyType, 'dynamic'), mass: asNumber(c.mass, 1) };
    case 'LightComponent':
      return {
        lightType: asString(c.lightType, 'directional'),
        color: asString(c.color),
        intensity: asNumber(c.intensity, 1)
      };
    case 'MobileController':
      // Tuning EXCLUDED — see header exclusion (b). Presence only.
      return {};
    case 'WeaponController':
      return {
        damage: asNumber(c.damage, 25),
        fireRate: asNumber(c.fireRate, 8),
        range: asNumber(c.range, 100),
        maxAmmo: asNumber(c.maxAmmo, 30)
      };
    case 'HealthComponent':
      return {
        maxHealth: asNumber(c.maxHealth, 100),
        health: asNumber(c.health, 100),
        destroyOnDeath: asBoolean(c.destroyOnDeath, true)
      };
    case 'EnemyAI':
      return {
        targetName: asString(c.targetName, 'Player Hero'),
        moveSpeed: asNumber(c.moveSpeed, 2.5),
        attackDamage: asNumber(c.attackDamage, 10)
      };
    case 'VehicleController': {
      const wheels = (c.config as { wheels?: unknown } | undefined)?.wheels;
      const wheelCount = Array.isArray(wheels)
        ? wheels.length
        : Array.isArray(c.wheelSpecs)
          ? (c.wheelSpecs as unknown[]).length
          : 0;
      return {
        throttle: asNumber(c.throttle, 0),
        steering: asNumber(c.steering, 0),
        brake: asNumber(c.brake, 0),
        wheels: wheelCount
      };
    }
    case 'ElementalReactionComponent':
      return {
        aura: c.innateElement === undefined || c.innateElement === null ? null : asString(c.innateElement),
        maxHealth: asNumber(c.maxHealth, 100),
        health: asNumber(c.health, 100)
      };
    case 'EventSheet': {
      // Runner injects name/enabled/defaults; adapter stores raw spec —
      // compare only the preserved id + condition/action type sequences.
      const events = Array.isArray(c.events) ? c.events : [];
      return {
        events: events.map((ev, i) => {
          const e = (ev && typeof ev === 'object' ? ev : {}) as {
            id?: unknown;
            conditions?: unknown;
            actions?: unknown;
          };
          return {
            id: asString(e.id, `event_${i}`),
            conditions: conditionActionTypes(e.conditions),
            actions: conditionActionTypes(e.actions)
          };
        })
      };
    }
    case 'DayNightCycle':
      return {
        dayLengthSeconds: asNumber(c.dayLengthSeconds, 240),
        timeOfDay: asNumber(c.timeOfDay, 0.3)
      };
    default:
      return {};
  }
}

/** Canonical static graph of a built engine scene. */
export function canonicalSceneGraph(scene: GraphLike): CanonicalGraphNode[] {
  return scene.gameObjects
    .map((go) => {
      const params: Record<string, Record<string, unknown>> = {};
      for (const c of go.components) {
        const type = c.constructor.name;
        if (!(type in params)) params[type] = componentParams(type, c);
      }
      return {
        name: go.name,
        components: go.components.map((c) => c.constructor.name).sort(),
        transform: {
          // scale EXCLUDED — see header exclusion (c).
          position: asTriple(go.transform?.position, [0, 0, 0]),
          rotation: asTriple(go.transform?.rotation, [0, 0, 0])
        },
        params
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
