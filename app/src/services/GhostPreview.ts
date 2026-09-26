import * as THREE from 'three';

/**
 * GhostPreview — translucent placement-ghost manager for the studio viewport
 * (Track B.3 studio half). Agent-proposed placements render as ghosts BEFORE
 * anything is written: green = audit-valid, red = audit-invalid (RTS
 * ghostValidMat/ghostInvalidMat pattern). Validity comes from
 * POST /api/spatial/ghost; this service only draws.
 */

export interface GhostSpec {
  shape?: 'box' | 'sphere' | 'cylinder' | 'capsule';
  size?: [number, number, number];
  position?: [number, number, number];
}

export const GHOST_VALID = 0x22c55e;
export const GHOST_INVALID = 0xef4444;

/** Snap a world XZ point to the 1u placement grid. */
export function snapToGrid(x: number, z: number, grid = 1): { x: number; z: number } {
  return { x: Math.round(x / grid) * grid, z: Math.round(z / grid) * grid };
}

export class GhostPreview {
  private mesh: THREE.Mesh | null = null;
  private material: THREE.MeshBasicMaterial | null = null;

  constructor(private readonly threeScene: THREE.Scene) {}

  /** Show (or move) the ghost. Idempotent: reuses one mesh. */
  show(spec: GhostSpec): THREE.Mesh {
    const [sx, sy, sz] = spec.size ?? [1, 1, 1];
    const [px, py, pz] = spec.position ?? [0, 1, 0];
    const shape = spec.shape ?? 'box';

    let geometry: THREE.BufferGeometry | null = null;
    if (!this.mesh || this.mesh.userData.ghostShape !== shape) {
      this.dispose();
      switch (shape) {
        case 'sphere':
          geometry = new THREE.SphereGeometry(0.5, 16, 12);
          break;
        case 'cylinder':
          geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
          break;
        case 'capsule':
          geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 12);
          break;
        case 'box':
        default:
          geometry = new THREE.BoxGeometry(1, 1, 1);
          break;
      }
      this.material = new THREE.MeshBasicMaterial({
        color: GHOST_VALID,
        transparent: true,
        opacity: 0.45,
        depthWrite: false
      });
      this.mesh = new THREE.Mesh(geometry, this.material);
      this.mesh.userData.ghostShape = shape;
      this.mesh.userData.isGhost = true;
      this.threeScene.add(this.mesh);
    }
    this.mesh.scale.set(sx, sy, sz);
    this.mesh.position.set(px, py, pz);
    this.mesh.visible = true;
    return this.mesh;
  }

  /** Paint validity (green/red). No-op without a visible ghost. */
  setValidity(valid: boolean): void {
    this.material?.color.setHex(valid ? GHOST_VALID : GHOST_INVALID);
  }

  hide(): void {
    if (this.mesh) this.mesh.visible = false;
  }

  get visible(): boolean {
    return this.mesh?.visible ?? false;
  }

  dispose(): void {
    if (this.mesh) {
      this.threeScene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
  }
}

/** Ask the dev-server ghost probe for a placement verdict. */
export async function probePlacement(spec: Required<Pick<GhostSpec, 'position'>> & GhostSpec): Promise<{
  valid: boolean;
  walkable: boolean;
  supported: boolean;
  supportTop: number | null;
  clearance: number;
  defects: string[];
}> {
  const res = await fetch('/api/spatial/ghost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      placement: {
        name: 'Ghost',
        shape: spec.shape ?? 'box',
        size: spec.size ?? [1, 1, 1],
        position: spec.position,
        physics: 'dynamic'
      }
    })
  });
  if (!res.ok) throw new Error(`ghost probe failed: ${res.status}`);
  return res.json();
}
