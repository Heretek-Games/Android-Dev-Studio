import { Component } from '../core/Component.js';

export interface PathfollowOptions {
  /** Waypoints in world XZ (y follows the ground offset below). */
  waypoints?: Array<{ x: number; z: number }>;
  moveSpeed?: number;
  /** Loop the path, ping-pong it, or stop at the end. Default 'loop'. */
  mode?: 'loop' | 'pingpong' | 'once';
  /** Arrival radius per waypoint. Default 0.5. */
  arrivalRadius?: number;
  /** Hover height above y=0. Default 0. */
  groundOffset?: number;
}

/**
 * Pathfollow behavior (Track 1.3 behavior library).
 *
 * Patrols waypoints on the XZ plane (loop / ping-pong / once), facing travel
 * direction. Kinematic transform motion; headless-deterministic. Patrol
 * routes for NPCs, cameras, and moving hazards without any AI graph.
 */
export class Pathfollow extends Component {
  public waypoints: Array<{ x: number; z: number }> = [];
  public moveSpeed: number = 3.0;
  public mode: 'loop' | 'pingpong' | 'once' = 'loop';
  public arrivalRadius: number = 0.5;
  public groundOffset: number = 0;

  public waypointIndex: number = 0;
  public finished: boolean = false;

  private direction: 1 | -1 = 1;

  constructor(options?: PathfollowOptions) {
    super();
    if (options) {
      if (options.waypoints !== undefined) {
        this.waypoints = options.waypoints.map(w => ({ x: w.x, z: w.z }));
      }
      if (options.moveSpeed !== undefined) this.moveSpeed = options.moveSpeed;
      if (options.mode !== undefined) this.mode = options.mode;
      if (options.arrivalRadius !== undefined) this.arrivalRadius = options.arrivalRadius;
      if (options.groundOffset !== undefined) this.groundOffset = options.groundOffset;
    }
  }

  public override update(deltaTime: number): void {
    if (this.finished || this.waypoints.length === 0 || this.moveSpeed <= 0) return;
    const t = this.gameObject.transform;
    const target = this.waypoints[this.waypointIndex];
    const dx = target.x - t.position.x;
    const dz = target.z - t.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= this.arrivalRadius) {
      this.advance();
      return;
    }
    const step = Math.min(this.moveSpeed * deltaTime, dist);
    t.position.x += (dx / dist) * step;
    t.position.z += (dz / dist) * step;
    t.position.y = this.groundOffset;
    t.rotation.y = Math.atan2(dx, -dz);
  }

  private advance(): void {
    const last = this.waypoints.length - 1;
    if (this.mode === 'once' && this.waypointIndex === last && this.direction === 1) {
      this.finished = true;
      return;
    }
    if (this.mode === 'pingpong') {
      if (this.direction === 1 && this.waypointIndex === last) {
        this.direction = -1;
      } else if (this.direction === -1 && this.waypointIndex === 0) {
        this.direction = 1;
      } else {
        this.waypointIndex += this.direction;
        return;
      }
    } else {
      this.waypointIndex = (this.waypointIndex + 1) % this.waypoints.length;
      return;
    }
    this.waypointIndex += this.direction;
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'Pathfollow',
      enabled: this.enabled,
      waypoints: this.waypoints,
      moveSpeed: this.moveSpeed,
      mode: this.mode,
      arrivalRadius: this.arrivalRadius,
      groundOffset: this.groundOffset,
      waypointIndex: this.waypointIndex,
      finished: this.finished
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (Array.isArray(data.waypoints)) {
      this.waypoints = data.waypoints.map((w: { x: number; z: number }) => ({ x: w.x, z: w.z }));
    }
    if (data.moveSpeed !== undefined) this.moveSpeed = data.moveSpeed;
    if (data.mode !== undefined) this.mode = data.mode;
    if (data.arrivalRadius !== undefined) this.arrivalRadius = data.arrivalRadius;
    if (data.groundOffset !== undefined) this.groundOffset = data.groundOffset;
    if (data.waypointIndex !== undefined) this.waypointIndex = data.waypointIndex;
    if (data.finished !== undefined) this.finished = data.finished;
  }
}
