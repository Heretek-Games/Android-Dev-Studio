import type { Scene } from './Scene.js';
import type { GameObject } from './GameObject.js';
import { RigidBody3D } from '../components/RigidBody3D.js';

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export type OriginShiftListener = (shiftDelta: Vector3Like, cumulativeOffset: Vector3Like) => void;

export interface FloatingOriginOptions {
  /** Distance from (0,0,0) before an origin shift is triggered. Default: 500 world units. */
  thresholdDistance?: number;
  /** Whether to shift Rapier3D physics bodies as well. Default: true. */
  shiftPhysics?: boolean;
}

/**
 * FloatingOrigin — world origin shifting subsystem for large-scale environments.
 *
 * Prevents 32-bit IEEE 754 floating-point precision jitter in massive worlds
 * (Daggerfall Unity / OpenMW / Star Citizen pattern).
 *
 * When the tracking target (player hero or camera) moves beyond `thresholdDistance`
 * from the world origin (0, 0, 0), this subsystem translates all GameObjects and
 * physics bodies by `-offset`, keeping the active gameplay area near (0, 0, 0).
 *
 * It maintains `cumulativeOffset` so true global coordinates can be queried or reconstructed.
 */
export class FloatingOrigin {
  private thresholdDistance: number;
  private shiftPhysics: boolean;
  private target: GameObject | null = null;
  private cumulativeOffset: Vector3Like = { x: 0, y: 0, z: 0 };
  private listeners: Set<OriginShiftListener> = new Set();
  private lastShiftCount = 0;

  constructor(options: FloatingOriginOptions = {}) {
    this.thresholdDistance = Math.max(10, options.thresholdDistance ?? 500);
    this.shiftPhysics = options.shiftPhysics !== false;
  }

  /** Sets the primary tracking object (usually Player Hero or active camera GameObject). */
  public setTarget(target: GameObject | null): void {
    this.target = target;
  }

  public getTarget(): GameObject | null {
    return this.target;
  }

  public getCumulativeOffset(): Readonly<Vector3Like> {
    return this.cumulativeOffset;
  }

  public getShiftCount(): number {
    return this.lastShiftCount;
  }

  public addListener(listener: OriginShiftListener): void {
    this.listeners.add(listener);
  }

  public removeListener(listener: OriginShiftListener): void {
    this.listeners.delete(listener);
  }

  /** Converts local scene coordinates to global/macro coordinates. */
  public toGlobal(localPos: Vector3Like): Vector3Like {
    return {
      x: localPos.x + this.cumulativeOffset.x,
      y: localPos.y + this.cumulativeOffset.y,
      z: localPos.z + this.cumulativeOffset.z
    };
  }

  /** Converts global/macro coordinates to current local scene coordinates. */
  public toLocal(globalPos: Vector3Like): Vector3Like {
    return {
      x: globalPos.x - this.cumulativeOffset.x,
      y: globalPos.y - this.cumulativeOffset.y,
      z: globalPos.z - this.cumulativeOffset.z
    };
  }

  /**
   * Evaluates the tracking target's distance from (0,0,0).
   * If threshold is exceeded, shifts all entities in `scene` and fires listeners.
   * Returns true if a shift occurred.
   */
  public checkAndShift(scene: Scene): boolean {
    if (!this.target) return false;

    const pos = this.target.transform.position;
    const distSq = pos.x * pos.x + pos.z * pos.z; // check horizontal ground plane displacement
    const thresholdSq = this.thresholdDistance * this.thresholdDistance;

    if (distSq < thresholdSq) {
      return false;
    }

    // Offset to bring the target back to (0, y, 0)
    const shiftX = pos.x;
    const shiftZ = pos.z;

    this.shiftWorld(scene, shiftX, 0, shiftZ);
    return true;
  }

  /** Manually forces a world origin shift by the given translation. */
  public shiftWorld(scene: Scene, dx: number, dy: number, dz: number): void {
    if (dx === 0 && dy === 0 && dz === 0) return;

    for (const go of scene.gameObjects) {
      // Only shift root game objects so children inherit the shift via transform hierarchy
      if (!go.transform.parent) {
        const cur = go.transform.position;
        go.transform.setPosition(cur.x - dx, cur.y - dy, cur.z - dz);
      }

      if (this.shiftPhysics) {
        const rb = go.getComponent(RigidBody3D);
        if (rb && (rb as any).rapierBody) {
          try {
            const currentTrans = (rb as any).rapierBody.translation();
            (rb as any).rapierBody.setTranslation(
              {
                x: currentTrans.x - dx,
                y: currentTrans.y - dy,
                z: currentTrans.z - dz
              },
              true
            );
          } catch {
            // physics body translation fallback
          }
        }
      }
    }

    this.cumulativeOffset.x += dx;
    this.cumulativeOffset.y += dy;
    this.cumulativeOffset.z += dz;
    this.lastShiftCount++;

    const delta: Vector3Like = { x: dx, y: dy, z: dz };
    for (const listener of this.listeners) {
      try {
        listener(delta, this.cumulativeOffset);
      } catch (err) {
        console.error('Error in OriginShiftListener:', err);
      }
    }
  }

  public reset(): void {
    this.cumulativeOffset = { x: 0, y: 0, z: 0 };
    this.lastShiftCount = 0;
  }
}
