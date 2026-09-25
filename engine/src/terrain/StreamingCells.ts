import type { Scene } from '../core/Scene.js';

/**
 * HierarchicalStreamingCells — hierarchical world partitioning for dense urban
 * asset clustering and draw-distance management (GTA-class open worlds).
 *
 * The world is partitioned into nested levels (e.g. district → block → chunk).
 * Every streaming asset is clustered into the finest level; cell activation
 * follows per-level streaming rings around a focus point (the player/camera)
 * with hysteresis to prevent boundary thrashing. Draw distance is managed by
 * both the per-level rings and an adaptive draw-call budget: when the active
 * set would exceed the mobile budget, the outermost rings are trimmed and the
 * trim is reported for telemetry.
 *
 * Scene-bound assets have their GameObjects' `active` flag toggled so culled
 * clusters cost zero render work; headless use (QA/tests) works without a scene.
 * Cell state is a flat table, serializable for persistence (Veloren/rtsim-style).
 */

export interface CellLevelConfig {
  name: string;
  /** Cell size in meters for this level. */
  cellSize: number;
  /** Activation ring radius in meters around the focus. */
  ringRadius: number;
  /** Estimated draw calls contributed per active cell at this level. */
  drawsPerCell: number;
}

export interface StreamingAsset {
  id: string;
  x: number;
  y: number;
  z: number;
  gameObjectId?: string;
}

export interface CellInfo {
  key: string;
  level: number;
  levelName: string;
  cx: number;
  cz: number;
  centerX: number;
  centerZ: number;
  distance: number;
  active: boolean;
  assetCount: number;
}

export interface StreamingStats {
  focus: { x: number; y: number; z: number };
  activeCells: number;
  totalCells: number;
  activeCellsByLevel: number[];
  activeAssets: number;
  culledAssets: number;
  totalAssets: number;
  estimatedDrawCalls: number;
  drawBudget: number;
  budgetTrimmed: boolean;
}

const DEFAULT_LEVELS: CellLevelConfig[] = [
  { name: 'district', cellSize: 256, ringRadius: 900, drawsPerCell: 1 },
  { name: 'block', cellSize: 64, ringRadius: 300, drawsPerCell: 4 },
  { name: 'chunk', cellSize: 16, ringRadius: 96, drawsPerCell: 8 }
];

interface CellState {
  level: number;
  cx: number;
  cz: number;
  active: boolean;
  assetIds: Set<string>;
}

export class HierarchicalStreamingCells {
  public readonly levels: CellLevelConfig[];
  public readonly hysteresisFactor: number;
  public drawBudget: number;

  private focus = { x: 0, y: 0, z: 0 };
  private cells: Map<string, CellState> = new Map();
  private assets: Map<string, StreamingAsset & { cellKey: string }> = new Map();
  private budgetTrimmed = false;
  /** Persistent ring scale (shrinks under budget pressure, recovers with headroom). */
  private trimScale = 1;
  private scene?: Scene;

  constructor(options: { levels?: CellLevelConfig[]; hysteresisFactor?: number; drawBudget?: number; scene?: Scene } = {}) {
    this.levels = [...(options.levels ?? DEFAULT_LEVELS)].sort((a, b) => b.cellSize - a.cellSize);
    this.hysteresisFactor = options.hysteresisFactor ?? 1.25;
    this.drawBudget = options.drawBudget ?? 100;
    this.scene = options.scene;
  }

  // ---- Focus ---------------------------------------------------------------

  public setFocus(x: number, y: number, z: number): void {
    this.focus = { x, y, z };
  }

  // ---- Asset clustering ----------------------------------------------------

  private cellKeyFor(level: number, x: number, z: number): string {
    const size = this.levels[level].cellSize;
    return `${level}|${Math.floor(x / size)}|${Math.floor(z / size)}`;
  }

  private ensureCell(level: number, x: number, z: number): CellState {
    const key = this.cellKeyFor(level, x, z);
    let cell = this.cells.get(key);
    if (!cell) {
      const size = this.levels[level].cellSize;
      cell = {
        level,
        cx: Math.floor(x / size),
        cz: Math.floor(z / size),
        active: false,
        assetIds: new Set()
      };
      this.cells.set(key, cell);
    }
    return cell;
  }

  /** Clusters an asset into the finest level; parents exist at every level for streaming tiers. */
  public registerAsset(asset: StreamingAsset): void {
    this.unregisterAsset(asset.id);
    const finest = this.levels.length - 1;
    for (let level = 0; level < this.levels.length; level++) {
      this.ensureCell(level, asset.x, asset.z);
    }
    const cell = this.ensureCell(finest, asset.x, asset.z);
    cell.assetIds.add(asset.id);
    this.assets.set(asset.id, { ...asset, cellKey: this.cellKeyFor(finest, asset.x, asset.z) });
  }

  public unregisterAsset(id: string): boolean {
    const asset = this.assets.get(id);
    if (!asset) return false;
    this.cells.get(asset.cellKey)?.assetIds.delete(id);
    this.assets.delete(id);
    return true;
  }

  /** Moves an asset, re-clustering it (and its parent cells) when it crosses a boundary. */
  public moveAsset(id: string, x: number, y: number, z: number): void {
    const asset = this.assets.get(id);
    if (!asset) return;
    asset.x = x;
    asset.y = y;
    asset.z = z;
    const finest = this.levels.length - 1;
    const nextKey = this.cellKeyFor(finest, x, z);
    if (nextKey !== asset.cellKey) {
      this.cells.get(asset.cellKey)?.assetIds.delete(id);
      for (let level = 0; level < this.levels.length; level++) {
        this.ensureCell(level, x, z);
      }
      this.ensureCell(finest, x, z).assetIds.add(id);
      asset.cellKey = nextKey;
    }
  }

  // ---- Streaming update ----------------------------------------------------

  /**
   * Activates cells inside each level's ring and deactivates cells beyond the
   * hysteresis radius, then trims outer rings if the draw budget would be
   * exceeded. The trim scale persists across frames (stable, no thrash) and
   * recovers toward 1.0 when headroom returns. Returns telemetry for the frame.
   */
  public update(): StreamingStats {
    this.budgetTrimmed = false;

    // Shrink until the estimate fits the budget (force-culling, ignoring
    // hysteresis while trimming so load is actually shed).
    let guard = 0;
    while (this.estimateDrawCallsAtScale(this.trimScale) > this.drawBudget && this.trimScale > 0.1 && guard++ < 24) {
      this.trimScale = Math.max(0.1, this.trimScale * 0.85);
      this.budgetTrimmed = true;
      this.applyRings(this.trimScale, true);
    }

    // Recover toward full radius when there is comfortable headroom.
    if (!this.budgetTrimmed && this.trimScale < 1) {
      const candidate = Math.min(1, this.trimScale * 1.1);
      if (this.estimateDrawCallsAtScale(candidate) <= this.drawBudget) {
        this.trimScale = candidate;
      }
    }

    this.applyRings(this.trimScale, false);
    this.reconcileAssetVisibility();
    return this.stats();
  }

  /** Estimates draws for a hypothetical trim scale without mutating state. */
  private estimateDrawCallsAtScale(scale: number): number {
    let draws = 0;
    for (const cell of this.cells.values()) {
      const level = this.levels[cell.level];
      const size = level.cellSize;
      const centerX = (cell.cx + 0.5) * size;
      const centerZ = (cell.cz + 0.5) * size;
      const distance = Math.hypot(centerX - this.focus.x, centerZ - this.focus.z);
      if (distance <= level.ringRadius * scale) draws += level.drawsPerCell;
    }
    return draws;
  }

  private applyRings(scale: number, forceCull: boolean): void {
    for (const cell of this.cells.values()) {
      const level = this.levels[cell.level];
      const size = level.cellSize;
      const centerX = (cell.cx + 0.5) * size;
      const centerZ = (cell.cz + 0.5) * size;
      const distance = Math.hypot(centerX - this.focus.x, centerZ - this.focus.z);

      const activateRadius = level.ringRadius * scale;
      const deactivateRadius = forceCull ? activateRadius * 1.01 : activateRadius * this.hysteresisFactor;
      const wasActive = cell.active;
      const nextActive = wasActive ? distance <= deactivateRadius : distance <= activateRadius;
      cell.active = nextActive;
    }
  }

  /** Reconciles every clustered asset's GameObject visibility with its cell state. */
  private reconcileAssetVisibility(): void {
    if (!this.scene) return;
    for (const cell of this.cells.values()) {
      if (cell.assetIds.size === 0) continue;
      for (const assetId of cell.assetIds) {
        const asset = this.assets.get(assetId);
        if (!asset?.gameObjectId) continue;
        const go = this.scene.findById(asset.gameObjectId);
        if (go && go.active !== cell.active) go.active = cell.active;
      }
    }
  }

  // ---- Telemetry -----------------------------------------------------------

  public estimateDrawCalls(): number {
    let draws = 0;
    for (const cell of this.cells.values()) {
      if (cell.active) draws += this.levels[cell.level].drawsPerCell;
    }
    return draws;
  }

  public getActiveCells(level?: number): CellInfo[] {
    const result: CellInfo[] = [];
    for (const [key, cell] of this.cells) {
      if (!cell.active) continue;
      if (level !== undefined && cell.level !== level) continue;
      const cfg = this.levels[cell.level];
      const centerX = (cell.cx + 0.5) * cfg.cellSize;
      const centerZ = (cell.cz + 0.5) * cfg.cellSize;
      result.push({
        key,
        level: cell.level,
        levelName: cfg.name,
        cx: cell.cx,
        cz: cell.cz,
        centerX,
        centerZ,
        distance: Math.hypot(centerX - this.focus.x, centerZ - this.focus.z),
        active: true,
        assetCount: cell.assetIds.size
      });
    }
    return result.sort((a, b) => a.distance - b.distance);
  }

  public stats(): StreamingStats {
    let activeCells = 0;
    let activeAssets = 0;
    const activeCellsByLevel = this.levels.map(() => 0);

    for (const cell of this.cells.values()) {
      if (!cell.active) continue;
      activeCells++;
      activeCellsByLevel[cell.level]++;
      if (cell.level === this.levels.length - 1) activeAssets += cell.assetIds.size;
    }

    const totalAssets = this.assets.size;
    return {
      focus: { ...this.focus },
      activeCells,
      totalCells: this.cells.size,
      activeCellsByLevel,
      activeAssets,
      culledAssets: totalAssets - activeAssets,
      totalAssets,
      estimatedDrawCalls: this.estimateDrawCalls(),
      drawBudget: this.drawBudget,
      budgetTrimmed: this.budgetTrimmed
    };
  }

  public getAsset(id: string): StreamingAsset | undefined {
    return this.assets.get(id);
  }

  // ---- Persistence (flat table) -------------------------------------------

  public serialize(): { focus: { x: number; y: number; z: number }; cells: Array<{ key: string; active: boolean }> } {
    return {
      focus: { ...this.focus },
      cells: [...this.cells.entries()].map(([key, cell]) => ({ key, active: cell.active }))
    };
  }

  public restore(data: { focus: { x: number; y: number; z: number }; cells: Array<{ key: string; active: boolean }> }): void {
    this.setFocus(data.focus.x, data.focus.y, data.focus.z);
    for (const entry of data.cells) {
      const cell = this.cells.get(entry.key);
      if (cell) cell.active = entry.active;
    }
  }

  public clear(): void {
    this.cells.clear();
    this.assets.clear();
    this.budgetTrimmed = false;
  }
}
