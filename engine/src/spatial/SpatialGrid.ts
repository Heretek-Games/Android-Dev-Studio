/**
 * SpatialGrid — uniform 3D spatial hash for fast multi-entity proximity,
 * radius, and AABB queries (FPS/urban-sandbox traversal workloads).
 *
 * Entities are bucketed into cells of `cellSize` world units. Queries visit
 * only the cells that intersect the query volume instead of scanning the full
 * entity list, giving near-constant query cost for large populations.
 *
 * Pure compute subsystem: depends on nothing outside itself (Strict Decoupling).
 */

export interface SpatialEntry {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Optional payload (e.g. the owning GameObject or AI agent state). */
  ref?: unknown;
}

export interface SpatialGridStats {
  cells: number;
  entries: number;
  maxBucketSize: number;
}

export class SpatialGrid {
  private buckets: Map<string, SpatialEntry[]> = new Map();
  private byId: Map<string, SpatialEntry & { cellKey: string }> = new Map();
  private maxBucketSize = 0;

  constructor(private cellSize: number = 10) {
    if (cellSize <= 0) throw new Error('SpatialGrid cellSize must be > 0');
  }

  private cellKey(x: number, y: number, z: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return `${cx}|${cy}|${cz}`;
  }

  public insert(id: string, x: number, y: number, z: number, ref?: unknown): void {
    if (this.byId.has(id)) this.remove(id);
    const cellKey = this.cellKey(x, y, z);
    const entry: SpatialEntry & { cellKey: string } = { id, x, y, z, ref, cellKey };
    let bucket = this.buckets.get(cellKey);
    if (!bucket) {
      bucket = [];
      this.buckets.set(cellKey, bucket);
    }
    bucket.push(entry);
    if (bucket.length > this.maxBucketSize) this.maxBucketSize = bucket.length;
    this.byId.set(id, entry);
  }

  /** Repositions an entry, migrating it between cells only when it moved. */
  public update(id: string, x: number, y: number, z: number): void {
    const entry = this.byId.get(id);
    if (!entry) {
      this.insert(id, x, y, z);
      return;
    }
    const nextKey = this.cellKey(x, y, z);
    entry.x = x;
    entry.y = y;
    entry.z = z;
    if (nextKey !== entry.cellKey) {
      this.detach(entry);
      entry.cellKey = nextKey;
      let bucket = this.buckets.get(nextKey);
      if (!bucket) {
        bucket = [];
        this.buckets.set(nextKey, bucket);
      }
      bucket.push(entry);
      if (bucket.length > this.maxBucketSize) this.maxBucketSize = bucket.length;
    }
  }

  public remove(id: string): void {
    const entry = this.byId.get(id);
    if (!entry) return;
    this.detach(entry);
    this.byId.delete(id);
  }

  private detach(entry: SpatialEntry & { cellKey: string }): void {
    const bucket = this.buckets.get(entry.cellKey);
    if (!bucket) return;
    const idx = bucket.indexOf(entry);
    if (idx !== -1) bucket.splice(idx, 1);
    if (bucket.length === 0) this.buckets.delete(entry.cellKey);
  }

  /** All entries within `radius` of the point (inclusive). */
  public queryRadius(x: number, y: number, z: number, radius: number): SpatialEntry[] {
    const results = this.queryAABBInternal(x - radius, y - radius, z - radius, x + radius, y + radius, z + radius);
    const r2 = radius * radius;
    return results.filter(e => {
      const dx = e.x - x;
      const dy = e.y - y;
      const dz = e.z - z;
      return dx * dx + dy * dy + dz * dz <= r2;
    });
  }

  /** All entries whose point lies inside the axis-aligned box. */
  public queryAABB(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): SpatialEntry[] {
    return this.queryAABBInternal(minX, minY, minZ, maxX, maxY, maxZ);
  }

  private queryAABBInternal(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): SpatialEntry[] {
    const results: SpatialEntry[] = [];
    const cs = this.cellSize;
    const cx0 = Math.floor(minX / cs);
    const cy0 = Math.floor(minY / cs);
    const cz0 = Math.floor(minZ / cs);
    const cx1 = Math.floor(maxX / cs);
    const cy1 = Math.floor(maxY / cs);
    const cz1 = Math.floor(maxZ / cs);

    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const bucket = this.buckets.get(`${cx}|${cy}|${cz}`);
          if (!bucket) continue;
          for (const entry of bucket) {
            if (
              entry.x >= minX && entry.x <= maxX &&
              entry.y >= minY && entry.y <= maxY &&
              entry.z >= minZ && entry.z <= maxZ
            ) {
              results.push(entry);
            }
          }
        }
      }
    }
    return results;
  }

  /** Nearest entry to a point within `maxRadius`, or null when none. */
  public nearest(x: number, y: number, z: number, maxRadius: number): SpatialEntry | null {
    const candidates = this.queryRadius(x, y, z, maxRadius);
    let best: SpatialEntry | null = null;
    let bestDist = Infinity;
    for (const entry of candidates) {
      const dx = entry.x - x;
      const dy = entry.y - y;
      const dz = entry.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestDist) {
        bestDist = d2;
        best = entry;
      }
    }
    return best;
  }

  public get(id: string): SpatialEntry | undefined {
    return this.byId.get(id);
  }

  public get size(): number {
    return this.byId.size;
  }

  public stats(): SpatialGridStats {
    return {
      cells: this.buckets.size,
      entries: this.byId.size,
      maxBucketSize: this.maxBucketSize
    };
  }

  public clear(): void {
    this.buckets.clear();
    this.byId.clear();
    this.maxBucketSize = 0;
  }
}
