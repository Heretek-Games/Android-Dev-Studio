import type { GameObject } from '../core/GameObject.js';

/**
 * LODManager — camera-distance level-of-detail and culling subsystem.
 *
 * Enforces the mobile draw-call budget by keeping only the LOD-relevant slice
 * of the scene active. Each registered object declares ascending distance
 * thresholds: the object is marked with LOD level i while the camera is within
 * `distances[i]`; beyond the last threshold it is culled (deactivated).
 *
 * This is a pure compute subsystem: it never imports renderers, physics, or
 * game-specific logic (Strict Decoupling).
 */

export interface LODStats {
  registered: number;
  visible: number;
  culled: number;
  /** Number of visible objects per LOD level (index 0 = highest detail). */
  levelCounts: number[];
  /** Per-object mesh draw estimate for the currently visible set. */
  estimatedDrawCalls: number;
}

interface LODEntry {
  object: GameObject;
  distances: number[];
  level: number;
}

export class LODManager {
  private entries: Map<string, LODEntry> = new Map();
  private cameraX = 0;
  private cameraY = 0;
  private cameraZ = 0;
  private lastStats: LODStats = {
    registered: 0,
    visible: 0,
    culled: 0,
    levelCounts: [],
    estimatedDrawCalls: 0
  };

  /**
   * Register a GameObject with ascending distance thresholds (world units).
   * Example: [20, 60, 150] → level 0 within 20, level 1 within 60,
   * level 2 within 150, culled beyond 150.
   */
  public register(object: GameObject, distances: number[]): void {
    if (!distances.length) {
      throw new Error('LODManager.register requires at least one distance threshold');
    }
    this.entries.set(object.id, { object, distances: [...distances].sort((a, b) => a - b), level: 0 });
  }

  public unregister(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.object.active = true; // never leave an object stranded in a culled state
    this.entries.delete(id);
  }

  public setCameraPosition(x: number, y: number, z: number): void {
    this.cameraX = x;
    this.cameraY = y;
    this.cameraZ = z;
  }

  /** Re-evaluates every registered object's LOD level and visibility. */
  public update(): LODStats {
    let visible = 0;
    let culled = 0;
    const levelCounts: number[] = [];

    for (const entry of this.entries.values()) {
      const dx = entry.object.transform.position.x - this.cameraX;
      const dy = entry.object.transform.position.y - this.cameraY;
      const dz = entry.object.transform.position.z - this.cameraZ;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      let level = -1;
      for (let i = 0; i < entry.distances.length; i++) {
        if (distance <= entry.distances[i]) {
          level = i;
          break;
        }
      }

      if (level === -1) {
        entry.object.active = false;
        entry.level = entry.distances.length;
        culled++;
      } else {
        entry.object.active = true;
        entry.level = level;
        visible++;
        levelCounts[level] = (levelCounts[level] || 0) + 1;
      }
    }

    for (let i = 0; i < levelCounts.length; i++) {
      if (levelCounts[i] === undefined) levelCounts[i] = 0;
    }

    this.lastStats = {
      registered: this.entries.size,
      visible,
      culled,
      levelCounts,
      estimatedDrawCalls: visible
    };
    return this.lastStats;
  }

  /** Current LOD level for an object, or -1 when unregistered/culled. */
  public getLevel(id: string): number {
    const entry = this.entries.get(id);
    if (!entry) return -1;
    return entry.level >= entry.distances.length ? -1 : entry.level;
  }

  public getStats(): LODStats {
    return { ...this.lastStats, levelCounts: [...this.lastStats.levelCounts] };
  }

  public clear(): void {
    for (const entry of this.entries.values()) {
      entry.object.active = true;
    }
    this.entries.clear();
  }
}
