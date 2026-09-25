/**
 * GridPathfinder — large-scale grid navigation with hierarchical A*.
 *
 * Two-phase pathfinding for macro-simulation and city-builder workloads:
 *   1. A coarse A* plans a route over chunk-sized cells (optimistic: a chunk
 *      is traversable when at least one cell inside it is open).
 *   2. Fine A* refines each inter-chunk segment on the full-resolution grid;
 *      the concatenated path is re-validated for adjacency + walkability.
 * If any refinement step fails, the finder falls back to flat full-grid A*,
 * so the result is always a valid path when one exists.
 *
 * Pure compute subsystem: depends on nothing outside itself (Strict Decoupling).
 */

export class NavGrid {
  public readonly blocked: Uint8Array;

  constructor(public readonly width: number, public readonly height: number) {
    if (width <= 0 || height <= 0) throw new Error('NavGrid dimensions must be > 0');
    this.blocked = new Uint8Array(width * height);
  }

  public inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  public isBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    return this.blocked[y * this.width + x] === 1;
  }

  public setBlocked(x: number, y: number, isBlocked: boolean = true): void {
    if (!this.inBounds(x, y)) return;
    this.blocked[y * this.width + x] = isBlocked ? 1 : 0;
  }

  public setRectBlocked(x0: number, y0: number, x1: number, y1: number, isBlocked: boolean = true): void {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        this.setBlocked(x, y, isBlocked);
      }
    }
  }
}

export interface PathPoint {
  x: number;
  y: number;
}

export interface PathfindingStats {
  nodesExpanded: number;
  coarseNodesExpanded: number;
  usedHierarchy: boolean;
  /** How many times the hierarchy plan had to fall back to flat A*. */
  fallbackToFlat: boolean;
}

interface ChunkPlan {
  seq: Array<{ cx: number; cy: number }>;
}

const DIRECTIONS_4: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

export class GridPathfinder {
  private readonly chunkSize: number;

  public lastStats: PathfindingStats = {
    nodesExpanded: 0,
    coarseNodesExpanded: 0,
    usedHierarchy: false,
    fallbackToFlat: false
  };

  constructor(private readonly grid: NavGrid, options: { chunkSize?: number; hierarchical?: boolean } = {}) {
    this.chunkSize = options.hierarchical === false ? 1 : Math.max(1, options.chunkSize ?? 8);
  }

  public findPath(start: PathPoint, goal: PathPoint): PathPoint[] | null {
    this.lastStats = { nodesExpanded: 0, coarseNodesExpanded: 0, usedHierarchy: false, fallbackToFlat: false };

    if (this.grid.isBlocked(start.x, start.y) || this.grid.isBlocked(goal.x, goal.y)) return null;
    if (start.x === goal.x && start.y === goal.y) return [{ x: start.x, y: start.y }];

    if (this.chunkSize > 1) {
      const coarse = this.coarsePlan(start, goal);
      if (coarse) {
        const refined = this.refine(coarse, start, goal);
        if (refined && this.validate(refined, start, goal)) {
          this.lastStats.usedHierarchy = true;
          return refined;
        }
      }
      this.lastStats.fallbackToFlat = true;
    }

    return this.flatAStar(start, goal);
  }

  // ---- Coarse planning ----------------------------------------------------

  private chunkCounts(): { cxCount: number; cyCount: number } {
    return {
      cxCount: Math.ceil(this.grid.width / this.chunkSize),
      cyCount: Math.ceil(this.grid.height / this.chunkSize)
    };
  }

  private chunkTraversable(cx: number, cy: number): boolean {
    const x0 = cx * this.chunkSize;
    const y0 = cy * this.chunkSize;
    for (let y = y0; y < y0 + this.chunkSize; y++) {
      for (let x = x0; x < x0 + this.chunkSize; x++) {
        if (this.grid.inBounds(x, y) && !this.grid.isBlocked(x, y)) return true;
      }
    }
    return false;
  }

  private coarsePlan(start: PathPoint, goal: PathPoint): ChunkPlan | null {
    const { cxCount, cyCount } = this.chunkCounts();
    const scx = Math.floor(start.x / this.chunkSize);
    const scy = Math.floor(start.y / this.chunkSize);
    const gcx = Math.floor(goal.x / this.chunkSize);
    const gcy = Math.floor(goal.y / this.chunkSize);

    const open = (cx: number, cy: number): boolean =>
      cx >= 0 && cy >= 0 && cx < cxCount && cy < cyCount && this.chunkTraversable(cx, cy);

    const key = (cx: number, cy: number) => cy * cxCount + cx;
    const gScore = new Map<number, number>();
    const cameFrom = new Map<number, number>();
    const openSet = new MinHeap<number>();
    const h = (cx: number, cy: number) => Math.abs(cx - gcx) + Math.abs(cy - gcy);

    gScore.set(key(scx, scy), 0);
    openSet.push(key(scx, scy), h(scx, scy));
    let expanded = 0;

    while (openSet.size > 0) {
      const current = openSet.pop();
      if (current === key(gcx, gcy)) {
        this.lastStats.coarseNodesExpanded = expanded;
        // Reconstruct chunk sequence
        const seq: Array<{ cx: number; cy: number }> = [];
        let cursor: number | undefined = current;
        while (cursor !== undefined) {
          seq.push({ cx: cursor % cxCount, cy: Math.floor(cursor / cxCount) });
          cursor = cameFrom.get(cursor);
        }
        seq.reverse();
        return { seq };
      }
      expanded++;
      const cxc = current % cxCount;
      const cyc = Math.floor(current / cxCount);
      for (const [dx, dy] of DIRECTIONS_4) {
        const nx = cxc + dx;
        const ny = cyc + dy;
        if (!open(nx, ny)) continue;
        const tentative = (gScore.get(current) ?? Infinity) + 1;
        const nKey = key(nx, ny);
        if (tentative < (gScore.get(nKey) ?? Infinity)) {
          gScore.set(nKey, tentative);
          cameFrom.set(nKey, current);
          openSet.push(nKey, tentative + h(nx, ny));
        }
      }
    }
    this.lastStats.coarseNodesExpanded = expanded;
    return null;
  }

  // ---- Fine refinement -----------------------------------------------------

  private refine(plan: ChunkPlan, start: PathPoint, goal: PathPoint): PathPoint[] | null {
    // Waypoints: one representative open cell per intermediary chunk,
    // ordered from start to goal.
    const waypoints: PathPoint[] = [{ x: start.x, y: start.y }];
    for (let i = 1; i < plan.seq.length - 1; i++) {
      const rep = this.representativeCell(plan.seq[i].cx, plan.seq[i].cy, waypoints[waypoints.length - 1]);
      if (!rep) return null;
      waypoints.push(rep);
    }
    waypoints.push({ x: goal.x, y: goal.y });

    const full: PathPoint[] = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const segment = this.flatAStar(waypoints[i], waypoints[i + 1], /* accumulate */ true);
      if (!segment) return null;
      if (full.length) full.pop(); // merge shared endpoint
      full.push(...segment);
    }
    return full;
  }

  /** Closest open cell within a chunk to a reference position. */
  private representativeCell(cx: number, cy: number, from: PathPoint): PathPoint | null {
    const x0 = cx * this.chunkSize;
    const y0 = cy * this.chunkSize;
    let best: PathPoint | null = null;
    let bestDist = Infinity;
    for (let y = y0; y < y0 + this.chunkSize; y++) {
      for (let x = x0; x < x0 + this.chunkSize; x++) {
        if (!this.grid.inBounds(x, y) || this.grid.isBlocked(x, y)) continue;
        const d = Math.abs(x - from.x) + Math.abs(y - from.y);
        if (d < bestDist) {
          bestDist = d;
          best = { x, y };
        }
      }
    }
    return best;
  }

  private validate(path: PathPoint[], start: PathPoint, goal: PathPoint): boolean {
    if (!path.length) return false;
    if (path[0].x !== start.x || path[0].y !== start.y) return false;
    const last = path[path.length - 1];
    if (last.x !== goal.x || last.y !== goal.y) return false;
    for (let i = 0; i < path.length; i++) {
      if (this.grid.isBlocked(path[i].x, path[i].y)) return false;
      if (i > 0) {
        const dx = Math.abs(path[i].x - path[i - 1].x);
        const dy = Math.abs(path[i].y - path[i - 1].y);
        if (dx + dy !== 1) return false;
      }
    }
    return true;
  }

  // ---- Flat A* -------------------------------------------------------------

  private flatAStar(start: PathPoint, goal: PathPoint, accumulateStats: boolean = false): PathPoint[] | null {
    const width = this.grid.width;
    const key = (x: number, y: number) => y * width + x;
    const gScore = new Map<number, number>();
    const cameFrom = new Map<number, number>();
    const openSet = new MinHeap<number>();
    const h = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);

    gScore.set(key(start.x, start.y), 0);
    openSet.push(key(start.x, start.y), h(start.x, start.y));
    let expanded = 0;

    while (openSet.size > 0) {
      const current = openSet.pop();
      if (current === key(goal.x, goal.y)) {
        if (accumulateStats) this.lastStats.nodesExpanded += expanded;
        else this.lastStats.nodesExpanded = expanded;
        const path: PathPoint[] = [];
        let cursor: number | undefined = current;
        while (cursor !== undefined) {
          path.push({ x: cursor % width, y: Math.floor(cursor / width) });
          cursor = cameFrom.get(cursor);
        }
        path.reverse();
        return path;
      }
      expanded++;
      const cx = current % width;
      const cy = Math.floor(current / width);
      for (const [dx, dy] of DIRECTIONS_4) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.grid.inBounds(nx, ny) || this.grid.isBlocked(nx, ny)) continue;
        const tentative = (gScore.get(current) ?? Infinity) + 1;
        const nKey = key(nx, ny);
        if (tentative < (gScore.get(nKey) ?? Infinity)) {
          gScore.set(nKey, tentative);
          cameFrom.set(nKey, current);
          openSet.push(nKey, tentative + h(nx, ny));
        }
      }
    }
    this.lastStats.nodesExpanded += expanded;
    return null;
  }
}

/** Minimal binary min-heap keyed by numeric priority. */
class MinHeap<T> {
  private items: Array<{ value: T; priority: number }> = [];

  public get size(): number {
    return this.items.length;
  }

  public push(value: T, priority: number): void {
    this.items.push({ value, priority });
    this.bubbleUp(this.items.length - 1);
  }

  public pop(): T {
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return top.value;
  }

  private bubbleUp(index: number): void {
    const items = this.items;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].priority <= items[index].priority) break;
      [items[parent], items[index]] = [items[index], items[parent]];
      index = parent;
    }
  }

  private sinkDown(index: number): void {
    const items = this.items;
    const n = items.length;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < n && items[left].priority < items[smallest].priority) smallest = left;
      if (right < n && items[right].priority < items[smallest].priority) smallest = right;
      if (smallest === index) break;
      [items[smallest], items[index]] = [items[index], items[smallest]];
      index = smallest;
    }
  }
}
