/**
 * HarnessSceneAdapter — builds real engine objects from the canonical harness
 * scene spec so studio docks can run genuine subsystems (LODManager,
 * SpatialGrid, GridPathfinder, ALifeSimulator, EconomyTick) against it.
 *
 * Mirrors the scenario semantics of harness/agents/qa_scenario_runner.mjs so
 * in-studio analysis and headless QA agree on the same scene graph.
 */

import {
  Scene,
  GameObject,
  MeshRenderer,
  LightComponent,
  RigidBody3D,
  Collider3D,
  MobileController,
  EventSheet,
  type PrimitiveShape
} from '@heretek/engine';
import type { HarnessScene, HarnessSceneObject } from './SceneStore';

const MESH_KINDS = new Set(['mesh', 'model', 'terrain']);

/** Builds a real engine Scene from the flat harness scene schema. */
export function buildEngineScene(spec: HarnessScene): Scene {
  const scene = new Scene(spec.name || 'HarnessScene');
  for (const obj of spec.gameObjects || []) {
    const go = new GameObject(obj.name || 'Object');
    const pos = obj.position || [0, 0, 0];
    go.transform.setPosition(pos[0], pos[1], pos[2]);
    if (Array.isArray(obj.rotation) && obj.rotation.length >= 3) {
      go.transform.setRotation(obj.rotation[0], obj.rotation[1], obj.rotation[2]);
    }
    if (Array.isArray(obj.scale) && obj.scale.length >= 3) {
      go.transform.setScale(obj.scale[0], obj.scale[1], obj.scale[2]);
    }

    if (obj.kind === 'light') {
      go.addComponent(
        new LightComponent({
          type: (obj.lightType as 'directional' | 'point' | 'ambient') || 'directional',
          color: obj.color || '#ffffff',
          intensity: obj.intensity ?? 2.0
        })
      );
    } else {
      const size = (obj.size || [1, 1, 1]) as [number, number, number];
      go.addComponent(
        new MeshRenderer({
          shape: (obj.shape as PrimitiveShape) || 'box',
          size,
          color: obj.color || '#3b82f6',
          roughness: 0.4
        })
      );
      if (obj.physics && obj.physics !== 'none') {
        go.addComponent(
          new RigidBody3D({ bodyType: obj.physics, mass: obj.mass ?? 1.0 })
        );
        const colliderShape = obj.shape === 'plane' || obj.shape === 'torus' ? 'box' : (obj.shape || 'box');
        go.addComponent(
          new Collider3D({ shape: colliderShape as 'box' | 'sphere' | 'capsule' | 'cylinder', size })
        );
      }
      if (obj.controller) {
        go.addComponent(new MobileController());
      }
      if (Array.isArray(obj.events) && obj.events.length) {
        go.addComponent(new EventSheet(obj.events as any));
      }
    }
    scene.addGameObject(go);
  }
  return scene;
}

/** Deterministic draw-call estimate matching the headless QA runner. */
export function estimateDrawCalls(spec: HarnessScene): { drawCalls: number; batched: number } {
  let drawCalls = 0;
  let batched = 0;
  for (const obj of spec.gameObjects || []) {
    const kind = obj.kind || 'mesh';
    if (!MESH_KINDS.has(kind)) continue; // lights are not draws
    if (obj.batched) {
      batched++;
      continue;
    }
    drawCalls++;
  }
  return { drawCalls, batched };
}

export interface SceneBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Bounds of mesh/terrain objects on the ground plane (fallback: [-20, -20, 20, 20]). */
export function sceneBounds(spec: HarnessScene): SceneBounds {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const obj of spec.gameObjects || []) {
    if ((obj.kind || 'mesh') === 'light') continue;
    const pos = obj.position || [0, 0, 0];
    const size = obj.size || [1, 1, 1];
    minX = Math.min(minX, pos[0] - size[0] / 2);
    maxX = Math.max(maxX, pos[0] + size[0] / 2);
    minZ = Math.min(minZ, pos[2] - size[2] / 2);
    maxZ = Math.max(maxZ, pos[2] + size[2] / 2);
  }
  if (!Number.isFinite(minX)) return { minX: -20, minZ: -20, maxX: 20, maxZ: 20 };
  return { minX, minZ, maxX, maxZ };
}

/** Obstacle footprints in world space (fixed physics objects only). */
export function obstacleFootprints(
  spec: HarnessScene
): Array<{ name: string; x: number; z: number; halfX: number; halfZ: number }> {
  return (spec.gameObjects || [])
    .filter((obj: HarnessSceneObject) => obj.physics === 'fixed' && Array.isArray(obj.size))
    .map((obj: HarnessSceneObject) => ({
      name: obj.name,
      x: obj.position?.[0] ?? 0,
      z: obj.position?.[2] ?? 0,
      halfX: (obj.size?.[0] ?? 1) / 2,
      halfZ: (obj.size?.[2] ?? 1) / 2
    }));
}
