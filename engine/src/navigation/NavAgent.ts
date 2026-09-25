import { Component } from '../core/Component.js';
import { GridPathfinder, NavGrid, type PathPoint } from './GridPathfinder.js';
import { smoothPath } from './NavBake.js';

export interface NavLink {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Capture radius around each endpoint. Default 0.6. */
  radius?: number;
  /** Seconds to traverse. Default 0.7. */
  traverseTime?: number;
}

export interface NavAgentOptions {
  /** Agent radius (world units). Default 0.4. */
  radius?: number;
  /** Cruise speed (world units/s). Default 3. */
  speed?: number;
  /** Goal arrival radius. Default 0.4. */
  arriveRadius?: number;
  /** Waypoint acceptance radius. Default 0.3. */
  waypointRadius?: number;
  /** Separation push weight. Default 1.5. */
  separationWeight?: number;
  /** Neighbor radius for separation. Default 1.2. */
  separationRadius?: number;
  /** Braking distance before the goal. Default 1.5. */
  brakeRadius?: number;
  /** Grid + mapping for pathfinding (setGrid or per-destination grid). */
  grid?: NavGrid;
  cellSize?: number;
  originX?: number;
  originZ?: number;
  links?: NavLink[];
}

/** Neighbor sample for separation (world XZ). */
export interface NavNeighbor {
  x: number;
  z: number;
}

/**
 * NavAgent — kinematic task agent (Track 1.12, ADR-1790376435472).
 *
 * Follows GridPathfinder routes (funnel-smoothed) with arrival braking,
 * spatial separation (Detour-style capped neighbor push), and off-mesh-link
 * traversal. Physics-none kinematic per ADR-1790361143614. Neighbors arrive
 * through an injectable sampler (studio wires SpatialGrid; tests inject
 * lambdas), and a velocity hook mirrors Godot's velocity_computed callback
 * so full ORCA can drop in later without touching movers.
 */
export class NavAgent extends Component {
  public radius: number = 0.4;
  public speed: number = 3;
  public arriveRadius: number = 0.4;
  public waypointRadius: number = 0.3;
  public separationWeight: number = 1.5;
  public separationRadius: number = 1.2;
  public brakeRadius: number = 1.5;
  public links: NavLink[] = [];

  public path: PathPoint[] = [];
  /** True only after consuming a planned route (never vacuous: fresh or
   * failed destinations read false so nav_arrived cannot pass unrouted). */
  public arrived: boolean = false;
  public traversing: boolean = false;

  private grid: NavGrid | null = null;
  private cellSize: number = 1;
  private originX: number = 0;
  private originZ: number = 0;
  private sampler: ((self: NavAgent) => NavNeighbor[]) | null = null;
  private traverseT: number = 0;
  private traverseDur: number = 0.7;
  private traverseFrom: [number, number] = [0, 0];
  private traverseTo: [number, number] = [0, 0];
  private traverseY0: number = 0;
  private goalCell: PathPoint | null = null;
  private simTime: number = 0;
  private linkBan: { index: number; until: number } | null = null;

  constructor(options?: NavAgentOptions) {
    super();
    if (options) this.applyOptions(options);
  }

  private applyOptions(options: NavAgentOptions): void {
    const o = options;
    if (o.radius !== undefined) this.radius = Math.max(0.05, o.radius);
    if (o.speed !== undefined) this.speed = Math.max(0, o.speed);
    if (o.arriveRadius !== undefined) this.arriveRadius = Math.max(0.05, o.arriveRadius);
    if (o.waypointRadius !== undefined) this.waypointRadius = Math.max(0.05, o.waypointRadius);
    if (o.separationWeight !== undefined) this.separationWeight = Math.max(0, o.separationWeight);
    if (o.separationRadius !== undefined) this.separationRadius = Math.max(0, o.separationRadius);
    if (o.brakeRadius !== undefined) this.brakeRadius = Math.max(0.05, o.brakeRadius);
    if (o.grid !== undefined) this.grid = o.grid;
    if (o.cellSize !== undefined) this.cellSize = Math.max(0.01, o.cellSize);
    if (o.originX !== undefined) this.originX = o.originX;
    if (o.originZ !== undefined) this.originZ = o.originZ;
    if (o.links !== undefined) {
      this.links = o.links.map(l => ({
        ax: l.ax, az: l.az, bx: l.bx, bz: l.bz,
        radius: l.radius ?? 0.6,
        traverseTime: Math.max(0.05, l.traverseTime ?? 0.7)
      }));
    }
  }

  public setGrid(grid: NavGrid, cellSize = 1, originX = 0, originZ = 0): void {
    this.grid = grid;
    this.cellSize = cellSize;
    this.originX = originX;
    this.originZ = originZ;
  }

  /** Neighbor sampler for separation (studio: SpatialGrid radius query). */
  public setNeighborSampler(sampler: ((self: NavAgent) => NavNeighbor[]) | null): void {
    this.sampler = sampler;
  }

  /** Godot-style velocity hook: receives the computed safe velocity pre-move. */
  public onVelocityComputed: ((vx: number, vz: number) => void) | null = null;

  private toCell(x: number, z: number): PathPoint {
    return {
      x: Math.floor((x - this.originX) / this.cellSize),
      y: Math.floor((z - this.originZ) / this.cellSize)
    };
  }

  private toWorld(cell: PathPoint): [number, number] {
    return [
      this.originX + (cell.x + 0.5) * this.cellSize,
      this.originZ + (cell.y + 0.5) * this.cellSize
    ];
  }

  /**
   * Plans a route to world (x, z). Falls back to link-bridged routing when
   * no grid path exists: a link whose near end is reachable and whose far
   * end reaches the goal contributes [...pathToNear, farCell]; capture +
   * post-traverse replan handle the rest. Returns false when gridless or
   * unroutable (arrived reads false — never vacuous).
   */
  public setDestination(x: number, z: number): boolean {
    if (!this.grid) {
      this.arrived = false;
      return false;
    }
    const t = this.gameObject.transform.position;
    const goal = this.toCell(x, z);
    let raw = new GridPathfinder(this.grid).findPath(this.toCell(t.x, t.z), goal);
    if (!raw || raw.length === 0) {
      raw = this.routeViaLink(this.toCell(t.x, t.z), goal);
    }
    if (!raw || raw.length === 0) {
      this.arrived = false;
      return false;
    }
    const smooth = smoothPath(this.grid, raw);
    this.path = smooth.slice(1); // drop the standing cell
    this.goalCell = goal;
    this.arrived = this.path.length === 0;
    this.traversing = false;
    return true;
  }

  private routeViaLink(start: PathPoint, goal: PathPoint): PathPoint[] | null {
    if (!this.grid) return null;
    const finder = new GridPathfinder(this.grid);
    for (const link of this.links) {
      const ends: Array<[PathPoint, PathPoint]> = [
        [this.toCell(link.ax, link.az), this.toCell(link.bx, link.bz)],
        [this.toCell(link.bx, link.bz), this.toCell(link.ax, link.az)]
      ];
      for (const [near, far] of ends) {
        // Endpoints must be walkable cells (links bridge gaps, not walls).
        if (this.grid.isBlocked(near.x, near.y) || this.grid.isBlocked(far.x, far.y)) continue;
        const head = finder.findPath(start, near);
        if (!head || head.length === 0) continue;
        const tail = finder.findPath(far, goal);
        if (!tail) continue;
        const bridged = [...head];
        if (tail.length > 0 && (bridged.length === 0 || tail[0].x !== bridged[bridged.length - 1].x || tail[0].y !== bridged[bridged.length - 1].y)) {
          bridged.push(tail[0]);
        }
        for (let i = 1; i < tail.length; i++) bridged.push(tail[i]);
        return bridged;
      }
    }
    return null;
  }

  /** Remaining world-space distance to the final waypoint (Infinity when idle). */
  public distanceToGoal(): number {
    if (this.path.length === 0) return this.arrived ? 0 : Infinity;
    const t = this.gameObject.transform.position;
    const last = this.path[this.path.length - 1];
    const [wx, wz] = this.toWorld(last);
    return Math.hypot(wx - t.x, wz - t.z);
  }

  public override update(deltaTime: number): void {
    const t = this.gameObject.transform;
    this.simTime += deltaTime;
    if (this.traversing) {
      this.traverseT += deltaTime;
      const alpha = Math.min(1, this.traverseT / this.traverseDur);
      // Ballistic arc across the link gap, relative to the takeoff height.
      const height = 1.2 * 4 * alpha * (1 - alpha);
      t.position.x = this.traverseFrom[0] + (this.traverseTo[0] - this.traverseFrom[0]) * alpha;
      t.position.z = this.traverseFrom[1] + (this.traverseTo[1] - this.traverseFrom[1]) * alpha;
      t.position.y = this.traverseY0 + height;
      if (alpha >= 1) {
        this.traversing = false;
        t.position.y = this.traverseY0;
        // Ban the just-used link briefly so the landing (inside the far
        // capture radius) does not re-trigger it — UE re-arm parity.
        if (this.linkBan) this.linkBan.until = this.simTime + Math.max(1, this.traverseDur * 2);
        // Replan from the landing to the original goal (links are not
        // grid-routable; without a stored goal the agent would idle).
        if (this.goalCell && this.grid) {
          const raw = new GridPathfinder(this.grid).findPath(this.toCell(t.position.x, t.position.z), this.goalCell);
          if (raw && raw.length > 0) {
            this.path = smoothPath(this.grid, raw).slice(1);
            this.arrived = this.path.length === 0;
          } else {
            this.path = [];
            this.arrived = false;
          }
        }
      }
      return;
    }
    if (this.arrived || this.path.length === 0 || this.speed <= 0) return;

    // Off-mesh link capture before steering.
    const captured = this.captureLink(t.position.x, t.position.z);
    if (captured) {
      const link = captured.link;
      this.traversing = true;
      this.traverseT = 0;
      this.traverseDur = link.traverseTime;
      this.linkBan = { index: captured.index, until: 0 };
      const nearA = Math.hypot(t.position.x - link.ax, t.position.z - link.az) <= (link.radius ?? 0.6);
      this.traverseFrom = [t.position.x, t.position.z];
      this.traverseY0 = t.position.y;
      this.traverseTo = nearA ? [link.bx, link.bz] : [link.ax, link.az];
      return;
    }

    // Consume reached waypoints first so steering aims at live targets.
    while (this.path.length > 0) {
      const [nx, nz] = this.toWorld(this.path[0]);
      if (Math.hypot(nx - t.position.x, nz - t.position.z) > this.waypointRadius) break;
      this.path.shift();
    }
    if (this.path.length === 0) {
      this.arrived = true;
      return;
    }

    // Arrival braking on the final leg.
    const [wx, wz] = this.toWorld(this.path[0]);
    const dx = wx - t.position.x;
    const dz = wz - t.position.z;
    const dist = Math.hypot(dx, dz);
    const isFinal = this.path.length === 1;
    const brake = isFinal ? Math.min(1, dist / this.brakeRadius) : 1;
    let vx = dist > 0 ? (dx / dist) * this.speed * brake : 0;
    let vz = dist > 0 ? (dz / dist) * this.speed * brake : 0;

    // Separation over capped neighbors (Detour-style, inverse-square).
    if (this.sampler && this.separationWeight > 0) {
      const neighbors = this.sampler(this).slice(0, 6);
      let sx = 0;
      let sz = 0;
      for (const n of neighbors) {
        const ox = t.position.x - n.x;
        const oz = t.position.z - n.z;
        const d = Math.hypot(ox, oz);
        if (d <= 0 || d >= this.separationRadius) continue;
        const push = (1 - d / this.separationRadius) / Math.max(d, 0.05);
        sx += (ox / Math.max(d, 1e-6)) * push;
        sz += (oz / Math.max(d, 1e-6)) * push;
      }
      vx += sx * this.separationWeight;
      vz += sz * this.separationWeight;
      const vlen = Math.hypot(vx, vz);
      if (vlen > this.speed && this.speed > 0) {
        vx = (vx / vlen) * this.speed;
        vz = (vz / vlen) * this.speed;
      }
    }

    if (this.onVelocityComputed) this.onVelocityComputed(vx, vz);
    t.position.x += vx * deltaTime;
    t.position.z += vz * deltaTime;
    if (vx !== 0 || vz !== 0) t.rotation.y = Math.atan2(vx, -vz);
  }

  private captureLink(
    x: number,
    z: number
  ): { link: NavLink & { radius: number; traverseTime: number }; index: number } | null {
    for (let i = 0; i < this.links.length; i++) {
      if (this.linkBan && this.linkBan.index === i && this.simTime < this.linkBan.until) continue;
      const link = this.links[i];
      const radius = link.radius ?? 0.6;
      const nearA = Math.hypot(x - link.ax, z - link.az) <= radius;
      const nearB = Math.hypot(x - link.bx, z - link.bz) <= radius;
      if (nearA || nearB) {
        return { link: { ...link, radius, traverseTime: Math.max(0.05, link.traverseTime ?? 0.7) }, index: i };
      }
    }
    return null;
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'NavAgent',
      enabled: this.enabled,
      radius: this.radius,
      speed: this.speed,
      arriveRadius: this.arriveRadius,
      waypointRadius: this.waypointRadius,
      separationWeight: this.separationWeight,
      separationRadius: this.separationRadius,
      brakeRadius: this.brakeRadius,
      cellSize: this.cellSize,
      originX: this.originX,
      originZ: this.originZ,
      links: this.links.map(l => ({ ...l })),
      path: this.path.map(p => ({ ...p })),
      arrived: this.arrived,
      traversing: this.traversing
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    this.applyOptions({
      radius: data.radius ?? this.radius,
      speed: data.speed ?? this.speed,
      arriveRadius: data.arriveRadius ?? this.arriveRadius,
      waypointRadius: data.waypointRadius ?? this.waypointRadius,
      separationWeight: data.separationWeight ?? this.separationWeight,
      separationRadius: data.separationRadius ?? this.separationRadius,
      brakeRadius: data.brakeRadius ?? this.brakeRadius,
      cellSize: data.cellSize ?? this.cellSize,
      originX: data.originX ?? this.originX,
      originZ: data.originZ ?? this.originZ,
      links: data.links ?? this.links
    });
    // Grid is scene-owned (rebound by whoever built it); path restores verbatim.
    if (Array.isArray(data.path)) this.path = data.path.map((p: PathPoint) => ({ x: p.x, y: p.y }));
    if (typeof data.arrived === 'boolean') this.arrived = data.arrived;
    if (typeof data.traversing === 'boolean') this.traversing = data.traversing;
  }
}
