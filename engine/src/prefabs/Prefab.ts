import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { LightComponent } from '../components/LightComponent.js';
import { HealthComponent } from '../components/HealthComponent.js';
import { EnemyAI } from '../components/EnemyAI.js';
import { RigidBody3D } from '../components/RigidBody3D.js';
import { Collider3D } from '../components/Collider3D.js';
import { MobileController } from '../components/MobileController.js';
import { WeaponController } from '../weapons/WeaponController.js';
import { ElementalReactionComponent } from '../combat/ElementalReactionComponent.js';
import type { ElementType } from '../combat/ElementalSystem.js';
import { AnimeCelShader } from '../shaders/AnimeCelShader.js';
import { EventSheet } from '../events/EventSheet.js';

/**
 * Prefab templates + variant chains for the runtime (Track 1.1).
 *
 * Mirrors harness/prefabs semantics in-engine: a prefab is a named object
 * template with an optional base; instantiation deep-merges template, stored
 * overrides, then per-instance overrides (explicit wins), and builds the real
 * component set from flat fields — the same mapping the headless QA runner
 * uses, so loop-authored content and runtime spawning agree.
 */

export interface PrefabDef {
  id: string;
  name?: string;
  /** Base prefab id for variants (resolved root-first, overrides win per level). */
  base?: string | null;
  /** Object fields: shape/size/color/physics/components. */
  template?: Record<string, unknown>;
  /** Stored overrides applied over the template (and over any base). */
  overrides?: Record<string, unknown>;
}

export type PrefabStore = Map<string, PrefabDef>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(base as object) } as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    if (isRecord(merged[key]) && isRecord(value)) {
      merged[key] = deepMerge(
        merged[key] as Record<string, unknown>,
        value
      );
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function numArray(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (Array.isArray(value) && value.length >= 3 && value.every(v => typeof v === 'number')) {
    return [value[0] as number, value[1] as number, value[2] as number];
  }
  return fallback;
}

/** Applies flat prefab fields onto a GameObject (mesh, physics, components). */
export function applyPrefabFields(go: GameObject, fields: Record<string, unknown>): void {
  const pos = numArray(fields['position'], [0, 0, 0]);
  go.transform.setPosition(pos[0], pos[1], pos[2]);
  const size = numArray(fields['size'], [1, 1, 1]);
  const shape = (
    typeof fields['shape'] === 'string' ? fields['shape'] : 'box'
  ) as 'box' | 'sphere' | 'cylinder' | 'capsule' | 'plane' | 'torus';

  if (fields['kind'] === 'light') {
    go.addComponent(
      new LightComponent({
        type: ((fields['lightType'] as string) || 'directional') as 'directional' | 'point' | 'ambient' | 'spot',
        color: (fields['color'] as string) || '#ffffff',
        intensity: (fields['intensity'] as number) ?? 2.0
      })
    );
    return;
  }

  go.addComponent(
    new MeshRenderer({
      shape,
      size,
      color: (fields['color'] as string) || '#3b82f6',
      roughness: 0.4
    })
  );
  const physics = fields['physics'];
  if (physics && physics !== 'none') {
    go.addComponent(
      new RigidBody3D({
        bodyType: physics as 'dynamic' | 'fixed' | 'kinematic',
        mass: (fields['mass'] as number) ?? 1.0
      })
    );
    go.addComponent(new Collider3D({ shape: shape as 'box' | 'sphere' | 'capsule' | 'cylinder', size }));
  }
  if (fields['controller']) {
    go.addComponent(new MobileController());
  }
  if (isRecord(fields['weapon'])) {
    go.addComponent(new WeaponController(fields['weapon'] as Record<string, never>));
  }
  if (isRecord(fields['health'])) {
    go.addComponent(new HealthComponent(fields['health'] as Record<string, never>));
  }
  if (isRecord(fields['ai'])) {
    go.addComponent(new EnemyAI(fields['ai'] as Record<string, never>));
  }
  if (isRecord(fields['elemental'])) {
    const spec = fields['elemental'] as Record<string, unknown>;
    const elemental = new ElementalReactionComponent();
    go.addComponent(elemental);
    if (typeof spec['aura'] === 'string') {
      elemental.receiveElementalAttack(spec['aura'] as ElementType, 0, 1);
    }
  }
  if (isRecord(fields['cel'])) {
    go.addComponent(new AnimeCelShader(fields['cel'] as Record<string, never>));
  }
  const events = fields['events'];
  if (Array.isArray(events) && events.length > 0) {
    const sheet = new EventSheet(
      events.map((ev: unknown, i: number) => {
        const e = (ev || {}) as Record<string, unknown>;
        return {
          id: (e['id'] as string) || `prefab_ev_${i}`,
          name: (e['name'] as string) || `Prefab Event ${i}`,
          enabled: (e['enabled'] as boolean) !== false,
          conditions: ((e['conditions'] as Array<{ type: string; params?: Record<string, unknown> }>) || [{ type: 'EveryFrame' }]).map(c => ({
            type: c.type as 'OnStart' | 'EveryFrame' | 'OnTouchTap' | 'OnButtonPress' | 'Timer' | 'TagNear',
            params: c.params
          })),
          actions: ((e['actions'] as Array<{ type: string; params?: Record<string, unknown> }>) || []).map(a => ({
            type: a.type as 'Translate' | 'RotateY' | 'ApplyImpulse' | 'SetColor' | 'Destroy' | 'SetScale',
            params: a.params
          }))
        };
      })
    );
    go.addComponent(sheet);
  }
}

/**
 * Instantiates a prefab into a scene: resolves the base chain root-first
 * (cycle-guarded), merges template + stored overrides + instance overrides,
 * builds the GameObject, and adds it to the scene.
 */
export function instantiatePrefab(
  scene: Scene,
  store: PrefabStore,
  prefabId: string,
  name: string,
  instanceOverrides: Record<string, unknown> = {}
): GameObject {
  const chain: PrefabDef[] = [];
  const seen: string[] = [];
  let current: string | null | undefined = prefabId;
  while (current) {
    if (seen.includes(current)) {
      throw new Error(`prefab base cycle: ${[...seen, current].join(' -> ')}`);
    }
    seen.push(current);
    const def = store.get(current);
    if (!def) {
      throw new Error(
        prefabId === current
          ? `unknown prefab '${prefabId}'`
          : `prefab '${prefabId}' extends unknown base '${current}'`
      );
    }
    chain.push(def);
    current = def.base ?? null;
  }

  let fields: Record<string, unknown> = {};
  for (const link of [...chain].reverse()) {
    fields = deepMerge(fields, link.template ?? {});
    fields = deepMerge(fields, link.overrides ?? {});
  }
  fields = deepMerge(fields, instanceOverrides);

  const go = new GameObject(name);
  applyPrefabFields(go, fields);
  // Stamp linkage AFTER field application so template fields can never
  // clobber it (and plain constructed objects stay prefabId === null).
  go.prefabId = prefabId;
  const def = store.get(prefabId);
  go.prefabBase = def?.base ?? null;
  scene.addGameObject(go);
  return go;
}
