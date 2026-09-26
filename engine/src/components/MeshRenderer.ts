import * as THREE from 'three';
import { Component } from '../core/Component.js';

export type PrimitiveShape = 'box' | 'sphere' | 'cylinder' | 'capsule' | 'plane' | 'torus';

/** Shading path selector (Track C.3): `pbr` shades Cook-Torrance on Tier 2,
 * `unlit` renders flat albedo (stylized/cel fallback — never delete the look). */
export type MaterialShading = 'pbr' | 'unlit';

/** glTF-shaped PBR factors (baseColor linear multipliers + metal/rough). */
export interface PbrMaterial {
  baseColor: [number, number, number];
  metallic: number;
  roughness: number;
  emissive: [number, number, number];
  shading: MaterialShading;
}

export const DEFAULT_PBR_MATERIAL: PbrMaterial = {
  baseColor: [1, 1, 1],
  metallic: 0,
  roughness: 0.9,
  emissive: [0, 0, 0],
  shading: 'pbr'
};

function clamp01(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : fallback;
  if (!Number.isFinite(num)) return fallback;
  return Math.min(1, Math.max(0, num));
}

function rgb01(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  return [clamp01(value[0], fallback[0]), clamp01(value[1], fallback[1]), clamp01(value[2], fallback[2])];
}

/** Normalize any partial material payload into a valid PbrMaterial (pure). */
export function normalizePbrMaterial(input?: Partial<PbrMaterial> | null): PbrMaterial {
  if (!input || typeof input !== 'object') return { ...DEFAULT_PBR_MATERIAL };
  return {
    baseColor: rgb01((input as Record<string, unknown>).baseColor, DEFAULT_PBR_MATERIAL.baseColor),
    metallic: clamp01((input as Record<string, unknown>).metallic, DEFAULT_PBR_MATERIAL.metallic),
    roughness: clamp01((input as Record<string, unknown>).roughness, DEFAULT_PBR_MATERIAL.roughness),
    emissive: rgb01((input as Record<string, unknown>).emissive, DEFAULT_PBR_MATERIAL.emissive),
    shading: (input as Record<string, unknown>).shading === 'unlit' ? 'unlit' : 'pbr'
  };
}

/** Validate a material payload: returns problem strings (empty = valid). */
export function validatePbrMaterial(input: unknown): string[] {
  const problems: string[] = [];
  if (!input || typeof input !== 'object') return ['material must be an object'];
  const record = input as Record<string, unknown>;
  for (const key of (['baseColor', 'emissive'] as const)) {
    const value = record[key];
    if (value !== undefined && (!Array.isArray(value) || value.length !== 3 ||
        !(value as unknown[]).every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1))) {
      problems.push(`${key} must be [r, g, b] in 0..1`);
    }
  }
  for (const key of (['metallic', 'roughness'] as const)) {
    const value = record[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) {
      problems.push(`${key} must be 0..1`);
    }
  }
  if (record.shading !== undefined && record.shading !== 'pbr' && record.shading !== 'unlit') {
    problems.push(`shading must be 'pbr' or 'unlit'`);
  }
  return problems;
}

export interface MeshRendererOptions {
  shape?: PrimitiveShape;
  color?: string | number;
  roughness?: number;
  metalness?: number;
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  size?: [number, number, number];
}

export class MeshRenderer extends Component {
  public shape: PrimitiveShape = 'box';
  public color: string = '#3b82f6';
  public roughness: number = 0.5;
  public metalness: number = 0.1;
  public wireframe: boolean = false;
  public castShadow: boolean = true;
  public receiveShadow: boolean = true;
  public size: [number, number, number] = [1, 1, 1];

  public threeMesh: THREE.Mesh | null = null;

  constructor(options?: MeshRendererOptions) {
    super();
    if (options) {
      if (options.shape) this.shape = options.shape;
      if (options.color !== undefined) this.color = options.color.toString();
      if (options.roughness !== undefined) this.roughness = options.roughness;
      if (options.metalness !== undefined) this.metalness = options.metalness;
      if (options.wireframe !== undefined) this.wireframe = options.wireframe;
      if (options.castShadow !== undefined) this.castShadow = options.castShadow;
      if (options.receiveShadow !== undefined) this.receiveShadow = options.receiveShadow;
      if (options.size) this.size = options.size;
    }
  }

  public override awake(): void {
    this.createMesh();
  }

  public override start(): void {
    if (this.threeMesh && this.gameObject.scene?.threeScene) {
      if (!this.threeMesh.parent) {
        this.gameObject.scene.threeScene.add(this.threeMesh);
      }
    }
  }

  public override update(_deltaTime: number): void {
    this.syncMeshTransform();
  }

  public override lateUpdate(_deltaTime: number): void {
    this.syncMeshTransform();
  }

  private syncMeshTransform(): void {
    if (!this.threeMesh) return;
    const t = this.gameObject.transform;
    if (t.parent) {
      t.updateMatrices();
      this.threeMesh.position.setFromMatrixPosition(t.worldMatrix);
      this.threeMesh.quaternion.setFromRotationMatrix(t.worldMatrix);
      this.threeMesh.scale.setFromMatrixScale(t.worldMatrix);
    } else {
      this.threeMesh.position.copy(t.position);
      this.threeMesh.rotation.copy(t.rotation);
      this.threeMesh.scale.copy(t.scale);
    }
    // Keep world matrices current so raycasts (weapons, queries) are correct
    // even without an active render loop (headless QA, tests).
    this.threeMesh.updateMatrixWorld();
  }

  public override onDestroy(): void {
    if (this.threeMesh) {
      if (this.threeMesh.parent) {
        this.threeMesh.parent.remove(this.threeMesh);
      }
      this.threeMesh.geometry.dispose();
      if (Array.isArray(this.threeMesh.material)) {
        this.threeMesh.material.forEach(m => m.dispose());
      } else {
        this.threeMesh.material.dispose();
      }
      this.threeMesh = null;
    }
  }

  public setMaterial(color?: string, roughness?: number, metalness?: number): void {
    if (color !== undefined) this.color = color;
    if (roughness !== undefined) this.roughness = roughness;
    if (metalness !== undefined) this.metalness = metalness;

    if (this.threeMesh && this.threeMesh.material instanceof THREE.MeshStandardMaterial) {
      this.threeMesh.material.color.set(this.color);
      this.threeMesh.material.roughness = this.roughness;
      this.threeMesh.material.metalness = this.metalness;
    }
  }

  /** Canonical PBR factors for export (linear baseColor via three.Color). */
  public getPbrMaterial(): PbrMaterial {
    const c = new THREE.Color(this.color);
    return normalizePbrMaterial({
      baseColor: [c.r, c.g, c.b],
      metallic: this.metalness,
      roughness: this.roughness,
      emissive: [0, 0, 0],
      shading: 'pbr'
    });
  }

  /** Apply a validated material payload; returns problems (empty = applied). */
  public setPbrMaterial(input: unknown): string[] {
    const problems = validatePbrMaterial(input);
    if (problems.length) return problems;
    const mat = normalizePbrMaterial(input as Partial<PbrMaterial>);
    const toSrgb = (v: number): string => {
      const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, s)) * 255).toString(16).padStart(2, '0');
    };
    this.setMaterial(
      `#${toSrgb(mat.baseColor[0])}${toSrgb(mat.baseColor[1])}${toSrgb(mat.baseColor[2])}`,
      mat.roughness,
      mat.metallic
    );
    return [];
  }

  private createGeometry(): THREE.BufferGeometry {
    const [sx, sy, sz] = this.size;
    switch (this.shape) {
      case 'sphere':
        return new THREE.SphereGeometry(sx / 2, 32, 24);
      case 'cylinder':
        return new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 32);
      case 'capsule':
        return new THREE.CapsuleGeometry(sx / 2, sy / 2, 16, 32);
      case 'plane':
        return new THREE.PlaneGeometry(sx, sz);
      case 'torus':
        return new THREE.TorusGeometry(sx / 2, sz / 4, 16, 32);
      case 'box':
      default:
        return new THREE.BoxGeometry(sx, sy, sz);
    }
  }

  private createMesh(): void {
    if (this.threeMesh) {
      this.onDestroy();
    }

    const geometry = this.createGeometry();
    const material = new THREE.MeshStandardMaterial({
      color: this.color,
      roughness: this.roughness,
      metalness: this.metalness,
      wireframe: this.wireframe
    });

    this.threeMesh = new THREE.Mesh(geometry, material);
    this.threeMesh.name = this.gameObject.name;
    this.threeMesh.castShadow = this.castShadow;
    this.threeMesh.receiveShadow = this.receiveShadow;
    this.threeMesh.userData.gameObject = this.gameObject;

    const t = this.gameObject.transform;
    this.threeMesh.position.copy(t.position);
    this.threeMesh.rotation.copy(t.rotation);
    this.threeMesh.scale.copy(t.scale);

    if (this.gameObject.scene?.threeScene) {
      this.gameObject.scene.threeScene.add(this.threeMesh);
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'MeshRenderer',
      enabled: this.enabled,
      shape: this.shape,
      color: this.color,
      roughness: this.roughness,
      metalness: this.metalness,
      wireframe: this.wireframe,
      castShadow: this.castShadow,
      receiveShadow: this.receiveShadow,
      size: this.size
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.shape) this.shape = data.shape;
    if (data.color) this.color = data.color;
    if (data.roughness !== undefined) this.roughness = data.roughness;
    if (data.metalness !== undefined) this.metalness = data.metalness;
    if (data.wireframe !== undefined) this.wireframe = data.wireframe;
    if (data.castShadow !== undefined) this.castShadow = data.castShadow;
    if (data.receiveShadow !== undefined) this.receiveShadow = data.receiveShadow;
    if (data.size) this.size = data.size;
    this.createMesh();
  }
}
