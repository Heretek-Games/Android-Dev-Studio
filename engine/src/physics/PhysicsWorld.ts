import RAPIER from '@dimforge/rapier3d-compat';

export interface ContactForce {
  colliderA: number;
  colliderB: number;
  totalForce: number;
}

export class PhysicsWorld {
  public static isInitialized = false;
  public world: RAPIER.World | null = null;
  public gravity: { x: number; y: number; z: number } = { x: 0, y: -9.81, z: 0 };
  public isReady = false;

  private initPromise: Promise<void> | null = null;
  private eventQueue: RAPIER.EventQueue | null = null;

  constructor(gx = 0, gy = -9.81, gz = 0) {
    this.gravity = { x: gx, y: gy, z: gz };
  }

  public async initialize(): Promise<void> {
    if (this.isReady) return;

    if (!PhysicsWorld.isInitialized) {
      if (!this.initPromise) {
        this.initPromise = RAPIER.init();
      }
      await this.initPromise;
      PhysicsWorld.isInitialized = true;
    }

    this.world = new RAPIER.World(this.gravity);
    this.isReady = true;
  }

  public step(dt: number = 1 / 60): void {
    if (!this.world || !this.isReady) return;
    this.world.timestep = dt;
    if (this.eventQueue) {
      this.world.step(this.eventQueue);
    } else {
      this.world.step();
    }
  }

  /** Enables contact-force event collection (Chaos-lite fracture triggers). */
  public enableContactForces(): void {
    if (!this.eventQueue) {
      this.eventQueue = new RAPIER.EventQueue(true);
    }
  }

  public get contactForcesEnabled(): boolean {
    return this.eventQueue !== null;
  }

  /** Drains this step's contact-force events (collider handles + magnitude). */
  public drainContactForces(): ContactForce[] {
    const out: ContactForce[] = [];
    if (!this.eventQueue) return out;
    this.eventQueue.drainContactForceEvents((event: RAPIER.TempContactForceEvent) => {
      out.push({
        colliderA: event.collider1(),
        colliderB: event.collider2(),
        totalForce: event.totalForceMagnitude()
      });
    });
    return out;
  }

  /** Resolves a collider handle to its GameObject (via userData), if any. */
  public gameObjectForCollider(handle: number): unknown | null {
    if (!this.world) return null;
    try {
      const collider = this.world.getCollider(handle);
      return (collider as unknown as { userData?: unknown }).userData ?? null;
    } catch {
      return null;
    }
  }

  public setGravity(x: number, y: number, z: number): void {
    this.gravity = { x, y, z };
    if (this.world) {
      this.world.gravity = this.gravity;
    }
  }

  public castRay(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxToi: number = 100.0,
    solid: boolean = true
  ): { hit: boolean; toi: number } {
    if (!this.world || !this.isReady) return { hit: false, toi: 0 };
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxToi, solid);
    if (hit) {
      return { hit: true, toi: hit.timeOfImpact };
    }
    return { hit: false, toi: 0 };
  }

  /**
   * Ray cast that also returns the contact normal at the hit point
   * (used by vehicle suspension and ground-alignment systems).
   */
  public castRayAndGetNormal(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxToi: number = 100.0,
    solid: boolean = true
  ): { hit: boolean; toi: number; normal: { x: number; y: number; z: number } } {
    const noHit = { hit: false, toi: 0, normal: { x: 0, y: 1, z: 0 } };
    if (!this.world || !this.isReady) return noHit;
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxToi, solid);
    if (hit) {
      const n = hit.normal;
      return { hit: true, toi: hit.timeOfImpact, normal: { x: n.x, y: n.y, z: n.z } };
    }
    return noHit;
  }

  public destroy(): void {
    if (this.world) {
      this.world.free();
      this.world = null;
      this.isReady = false;
    }
  }
}
