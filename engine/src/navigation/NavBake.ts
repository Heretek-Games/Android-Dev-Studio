import { NavGrid, type PathPoint } from './GridPathfinder.js';
import type { Scene } from '../core/Scene.js';
import { RigidBody3D } from '../components/RigidBody3D.js';
import { Collider3D } from '../components/Collider3D.js';

export interface BakeObstacle {
  /** Center in world XZ. */
  x: number;
  z: number;
  /** Half-extents in world units. */
  hx: number;
  hz: number;
}

export interface BakeOptions {
  /** World size of one cell. Default 1. */
  cellSize?: number;
  /** World X/Z of grid cell (0, 0). Default 0. */
  originX?: number;
  originZ?: number;
  /** Agent radius for erosion (Recast cell≈radius/3 pattern). Default 0.4. */
  agentRadius?: number;
}

export interface BakedNav {
  grid: NavGrid;
  cellSize: number;
  originX: number;
  originZ: number;
}

/**
 * Walkability baking (Track 1.12, ADR-1790376435472).
 *
 * Rasterizes static XZ footprints onto a NavGrid with agent-radius erosion
 * (Recast pattern, no Recast import): a cell is blocked when the obstacle
 * expanded by the agent radius covers the cell center. Rotation is ignored
 * (axis-aligned conservative cover — documented, matches the studio
 * obstacle-footprint audit).
 */
export function bakeWalkability(
  width: number,
  height: number,
  obstacles: BakeObstacle[],
  options?: BakeOptions
): BakedNav {
  const cellSize = options?.cellSize ?? 1;
  const originX = options?.originX ?? 0;
  const originZ = options?.originZ ?? 0;
  const agentRadius = options?.agentRadius ?? 0.4;
  const grid = new NavGrid(width, height);
  for (const o of obstacles) {
    const hx = Math.max(0, o.hx) + agentRadius;
    const hz = Math.max(0, o.hz) + agentRadius;
    const x0 = Math.max(0, Math.floor((o.x - hx - originX) / cellSize));
    const x1 = Math.min(width - 1, Math.floor((o.x + hx - originX) / cellSize));
    const z0 = Math.max(0, Math.floor((o.z - hz - originZ) / cellSize));
    const z1 = Math.min(height - 1, Math.floor((o.z + hz - originZ) / cellSize));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const cx = originX + (x + 0.5) * cellSize;
        const cz = originZ + (z + 0.5) * cellSize;
        if (Math.abs(cx - o.x) <= hx && Math.abs(cz - o.z) <= hz) {
          grid.setBlocked(x, z, true);
        }
      }
    }
  }
  return { grid, cellSize, originX, originZ };
}

/** Grid-cell line of sight (supercover walk; blocked cells fail). */
export function hasLineOfSight(grid: NavGrid, a: PathPoint, b: PathPoint): boolean {
  const dx = b.x - a.x;
  const dz = b.y - a.y;
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) * 2) || 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(a.x + dx * t);
    const z = Math.round(a.y + dz * t);
    if (grid.isBlocked(x, z)) return false;
  }
  return true;
}

/**
 * String-pull-lite path smoothing: greedy furthest-visible-node shortcutting
 * over grid portals. Never lengthens the path; corners only removed when the
 * straight segment is fully walkable.
 */
export function smoothPath(grid: NavGrid, path: PathPoint[]): PathPoint[] {
  if (path.length <= 2) return [...path];
  const out: PathPoint[] = [path[0]];
  let anchor = 0;
  while (anchor < path.length - 1) {
    // No early break: a further node can be visible past a nearer blocked
    // one (path bending around a corner), so scan the full remainder.
    let furthest = anchor + 1;
    for (let i = anchor + 2; i < path.length; i++) {
      if (hasLineOfSight(grid, path[anchor], path[i])) furthest = i;
    }
    out.push(path[furthest]);
    anchor = furthest;
  }
  return out;
}

/** Polyline length in cell units (smoothing must never increase it). */
export function pathLength(path: PathPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return total;
}

/**
 * Collects XZ footprints of fixed-physics box colliders in a scene
 * (engine-side twin of the studio obstacle-footprint audit). Thin slabs
 * (height < minHeight) are walkable and skipped so floors stay passable.
 */
export function collectStaticFootprints(scene: Scene, minHeight = 2): BakeObstacle[] {
  const out: BakeObstacle[] = [];
  for (const go of scene.gameObjects) {
    const body = go.getComponent(RigidBody3D);
    if (!body || body.bodyType !== 'fixed') continue;
    const collider = go.getComponent(Collider3D);
    const size = collider?.size ?? [1, 1, 1];
    if (size[1] < minHeight) continue;
    out.push({
      x: go.transform.position.x,
      z: go.transform.position.z,
      hx: Math.abs(size[0]) / 2,
      hz: Math.abs(size[2]) / 2
    });
  }
  return out;
}
