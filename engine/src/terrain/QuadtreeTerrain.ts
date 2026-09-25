/**
 * QuadtreeTerrain — Genshin-scale terrain LOD streaming.
 *
 * A quadtree over the world bounds subdivides toward the focus (player/camera)
 * and merges behind it, with hysteresis so nodes never thrash at the split
 * boundary. Every leaf carries:
 *   - a detail level derived from its depth (0 = root/coarsest)
 *   - a continuous `blend` factor (0..1) toward the next finer level, computed
 *     from where the focus sits inside the split band — this drives smooth
 *     LOD transitions instead of hard pops
 *   - an async loading state machine (queued → loading → ready) driven by an
 *     injectable loader, processed under a per-frame node budget so terrain
 *     never stalls the render loop (Terasology-style meshing queues).
 *
 * Pure compute: no rendering/physics dependencies; fully headless-testable.
 */

export type QuadtreeNodeState = 'queued' | 'loading' | 'ready';

export interface QuadtreeNode {
  id: string;
  depth: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
  size: number;
  state: QuadtreeNodeState;
  /** Detail level: 0 = root/coarsest, maxDepth = finest. */
  lod: number;
  /** 0..1 blend toward the next finer level (continuous LOD transition). */
  blend: number;
  distance: number;
}

export interface QuadtreeOptions {
  minX?: number;
  minZ?: number;
  maxX?: number;
  maxZ?: number;
  /** Maximum subdivision depth (default 6 → 64×64 leaf grid at the focus). */
  maxDepth?: number;
  /** Split when distance < size × factor (default 1.6). */
  splitDistanceFactor?: number;
  /** Merge only beyond split × hysteresis (default 1.5). */
  hysteresisFactor?: number;
  /** Node state transitions processed per update (default 4). */
  frameBudget?: number;
}

export interface QuadtreeStats {
  focus: { x: number; z: number };
  totalNodes: number;
  leaves: number;
  ready: number;
  loading: number;
  queued: number;
  maxDepthReached: number;
  /** Leaf count per detail level (index = lod). */
  lodCounts: number[];
}

export type QuadtreeLoader = (node: QuadtreeNode) => Promise<void> | void;

interface NodeInternal extends QuadtreeNode {
  children: NodeInternal[] | null;
  loadingResolved?: boolean;
}

export class QuadtreeTerrain {
  public readonly minX: number;
  public readonly minZ: number;
  public readonly maxX: number;
  public readonly maxZ: number;
  public readonly maxDepth: number;
  public readonly splitDistanceFactor: number;
  public readonly hysteresisFactor: number;
  public frameBudget: number;

  private root: NodeInternal;
  private focusX = 0;
  private focusZ = 0;
  private loader: QuadtreeLoader | null = null;
  private nodesProcessed = 0;

  constructor(options: QuadtreeOptions = {}) {
    this.minX = options.minX ?? -512;
    this.minZ = options.minZ ?? -512;
    this.maxX = options.maxX ?? 512;
    this.maxZ = options.maxZ ?? 512;
    this.maxDepth = options.maxDepth ?? 6;
    this.splitDistanceFactor = options.splitDistanceFactor ?? 1.6;
    this.hysteresisFactor = options.hysteresisFactor ?? 1.5;
    this.frameBudget = options.frameBudget ?? 4;
    this.root = this.createNode('0', 0, this.minX, this.minZ, this.maxX, this.maxZ);
  }

  private createNode(id: string, depth: number, minX: number, minZ: number, maxX: number, maxZ: number): NodeInternal {
    return {
      id,
      depth,
      minX,
      minZ,
      maxX,
      maxZ,
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
      size: maxX - minX,
      state: 'queued',
      lod: depth,
      blend: 0,
      distance: 0,
      children: null
    };
  }

  /** Injected async terrain loader (mesh generation, asset fetch, …). */
  public setLoader(loader: QuadtreeLoader): void {
    this.loader = loader;
  }

  public setFocus(x: number, z: number): void {
    this.focusX = x;
    this.focusZ = z;
  }

  public getFocus(): { x: number; z: number } {
    return { x: this.focusX, z: this.focusZ };
  }

  /**
   * Reconciles the tree with the focus and processes up to `frameBudget`
   * pending node loads. Call once per frame.
   */
  public update(_dt: number = 1 / 60): QuadtreeStats {
    this.nodesProcessed = 0;
    this.reconcile(this.root);
    this.processLoads();
    return this.getStats();
  }

  private distanceToNode(node: NodeInternal): number {
    // Distance from the focus to the node's AABB (0 when inside)
    const dx = Math.max(node.minX - this.focusX, 0, this.focusX - node.maxX);
    const dz = Math.max(node.minZ - this.focusZ, 0, this.focusZ - node.maxZ);
    return Math.sqrt(dx * dx + dz * dz);
  }

  private reconcile(node: NodeInternal): void {
    node.distance = this.distanceToNode(node);
    const splitRadius = node.size * this.splitDistanceFactor;
    const mergeRadius = splitRadius * this.hysteresisFactor;

    if (node.children) {
      // Merge when the focus has left the hysteresis band and children are done
      const childrenReady = node.children.every(child => this.subtreeReady(child));
      if (node.distance > mergeRadius && childrenReady) {
        this.disposeSubtree(node);
        node.children = null;
        node.state = 'ready';
      } else {
        for (const child of node.children) this.reconcile(child);
      }
    } else if (node.depth < this.maxDepth && node.distance <= splitRadius) {
      this.split(node);
      for (const child of node.children!) this.reconcile(child);
    }

    // Continuous LOD blend: a leaf that is close to its split threshold but
    // not yet split blends toward the finer appearance (1 at the split radius,
    // 0 at 1.25×) so the eventual split does not pop.
    if (node.children) {
      node.blend = 1;
    } else if (node.depth < this.maxDepth) {
      const band = Math.max(1e-6, splitRadius * 0.25);
      node.blend = Math.max(0, Math.min(1, (splitRadius * 1.25 - node.distance) / band));
    } else {
      node.blend = 1;
    }
    node.lod = node.depth;
  }

  private subtreeReady(node: NodeInternal): boolean {
    if (node.state !== 'ready') return false;
    if (!node.children) return true;
    return node.children.every(child => this.subtreeReady(child));
  }

  private split(node: NodeInternal): void {
    const halfX = (node.maxX - node.minX) / 2;
    const halfZ = (node.maxZ - node.minZ) / 2;
    const midX = node.minX + halfX;
    const midZ = node.minZ + halfZ;
    const depth = node.depth + 1;
    node.children = [
      this.createNode(`${node.id}.0`, depth, node.minX, node.minZ, midX, midZ),
      this.createNode(`${node.id}.1`, depth, midX, node.minZ, node.maxX, midZ),
      this.createNode(`${node.id}.2`, depth, node.minX, midZ, midX, node.maxZ),
      this.createNode(`${node.id}.3`, depth, midX, midZ, node.maxX, node.maxZ)
    ];
    node.state = 'ready';
  }

  private disposeSubtree(node: NodeInternal): void {
    if (!node.children) return;
    for (const child of node.children) {
      this.disposeSubtree(child);
    }
    node.children = null;
  }

  private processLoads(): void {
    const pending = this.collectPending();
    for (const node of pending) {
      if (this.nodesProcessed >= this.frameBudget) break;
      this.nodesProcessed++;
      if (node.state === 'queued') {
        node.state = 'loading';
        if (this.loader) {
          const result = this.loader(node);
          if (result && typeof (result as Promise<void>).then === 'function') {
            (result as Promise<void>).then(() => {
              node.state = 'ready';
            });
          } else {
            node.state = 'ready';
          }
        }
        // Without a loader, nodes stay 'loading' until one is injected.
      }
    }
  }

  private collectPending(): NodeInternal[] {
    const pending: NodeInternal[] = [];
    const visit = (node: NodeInternal) => {
      if (node.children) {
        for (const child of node.children) visit(child);
      } else if (node.state !== 'ready') {
        pending.push(node);
      }
    };
    visit(this.root);
    return pending;
  }

  public getVisibleNodes(): QuadtreeNode[] {
    const leaves: QuadtreeNode[] = [];
    const visit = (node: NodeInternal) => {
      if (node.children) {
        for (const child of node.children) visit(child);
      } else {
        leaves.push(node);
      }
    };
    visit(this.root);
    return leaves;
  }

  public getStats(): QuadtreeStats {
    let totalNodes = 0;
    let maxDepthReached = 0;
    let ready = 0;
    let loading = 0;
    let queued = 0;
    const lodCounts: number[] = new Array(this.maxDepth + 1).fill(0);
    let leaves = 0;

    const visit = (node: NodeInternal) => {
      totalNodes++;
      maxDepthReached = Math.max(maxDepthReached, node.depth);
      if (node.children) {
        for (const child of node.children) visit(child);
      } else {
        leaves++;
        lodCounts[node.lod] = (lodCounts[node.lod] || 0) + 1;
        if (node.state === 'ready') ready++;
        else if (node.state === 'loading') loading++;
        else queued++;
      }
    };
    visit(this.root);

    return {
      focus: { x: this.focusX, z: this.focusZ },
      totalNodes,
      leaves,
      ready,
      loading,
      queued,
      maxDepthReached,
      lodCounts
    };
  }

  public serialize(): { focus: { x: number; z: number }; maxDepthReached: number; leaves: number } {
    const stats = this.getStats();
    return { focus: stats.focus, maxDepthReached: stats.maxDepthReached, leaves: stats.leaves };
  }

  public restore(data: { focus: { x: number; z: number } }): void {
    this.setFocus(data.focus.x, data.focus.z);
    this.reconcile(this.root);
  }
}
