import RAPIER from '@dimforge/rapier3d-compat';
import { Component } from '../core/Component.js';
import { GameObject } from '../core/GameObject.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { RigidBody3D } from '../components/RigidBody3D.js';
import { Collider3D } from '../components/Collider3D.js';
import { ParticleSystem } from '../particles/ParticleSystem.js';
import type { PhysicsWorld } from '../physics/PhysicsWorld.js';

export interface DestructibleOptions {
  /** Shard grid subdivision [nx, ny, nz] (voronoi-lite box splits). Default [2, 2, 2]. */
  shardGrid?: [number, number, number];
  /** Jitter of internal split planes 0..0.49 (seeded, deterministic). Default 0.15. */
  shardJitter?: number;
  /** Seed for split jitter. Default 7. */
  seed?: number;
  /** Contact-force magnitude that fractures the object. Default 60. */
  impulseThreshold?: number;
  /** Max live dynamic shards before oldest merge early. Default 24. */
  maxLiveShards?: number;
  /** Seconds a sleeping shard survives before merging to static. Default 4. */
  sleepDelay?: number;
  /** Dust burst size on fracture (0 disables). Default 12. */
  dustBurst?: number;
  /** Dust tint. Default '#b8a88f'. */
  dustColor?: string;
}

export interface ShardSpec {
  offset: [number, number, number];
  size: [number, number, number];
}

/** Deterministic LCG (tool-time-style seeded splits, headless-stable). */
function lcg(state: number): () => number {
  let s = state >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Subdivides a box into a jittered shard grid (offline-authored pattern,
 * computed deterministically at fracture time from size + seed).
 */
export function shardPattern(
  size: [number, number, number],
  grid: [number, number, number],
  jitter: number,
  seed: number
): ShardSpec[] {
  const [nx, ny, nz] = [Math.max(1, Math.floor(grid[0])), Math.max(1, Math.floor(grid[1])), Math.max(1, Math.floor(grid[2]))];
  const rand = lcg(seed);
  const cuts: number[][] = [];
  const dims = [size[0], size[1], size[2]];
  const counts = [nx, ny, nz];
  for (let axis = 0; axis < 3; axis++) {
    const boundaries: number[] = [0];
    for (let i = 1; i < counts[axis]; i++) {
      const ideal = (i / counts[axis]) * dims[axis];
      const wobble = (rand() * 2 - 1) * jitter * (dims[axis] / counts[axis]);
      boundaries.push(ideal + wobble);
    }
    boundaries.push(dims[axis]);
    cuts.push(boundaries);
  }
  const out: ShardSpec[] = [];
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        const lo = [cuts[0][ix], cuts[1][iy], cuts[2][iz]];
        const hi = [cuts[0][ix + 1], cuts[1][iy + 1], cuts[2][iz + 1]];
        out.push({
          offset: [
            (lo[0] + hi[0]) / 2 - size[0] / 2,
            (lo[1] + hi[1]) / 2 - size[1] / 2,
            (lo[2] + hi[2]) / 2 - size[2] / 2
          ],
          size: [
            Math.max(0.05, hi[0] - lo[0]),
            Math.max(0.05, hi[1] - lo[1]),
            Math.max(0.05, hi[2] - lo[2])
          ]
        });
      }
    }
  }
  return out;
}

interface TrackedShard {
  go: GameObject;
  body: RigidBody3D;
  sleepDelay: number;
  sleepTimer: number;
  maxLive: number;
  merged: boolean;
}

/**
 * Destructible — Chaos-lite fracture on Rapier (Track 2.4, ADR-1790379806713).
 *
 * Godot-swap pattern: on contact-force threshold the owner hides and a
 * seeded shard grid spawns as dynamic bodies with outward burst velocities.
 * Shards live in a DestructionPool: dynamic -> sleep -> timed merge to
 * static rubble, hard-capped with oldest-first early merge. Fracture emits
 * a dust burst into the sibling (or auto-created) ParticleSystem.
 */
export class Destructible extends Component {
  public shardGrid: [number, number, number] = [2, 2, 2];
  public shardJitter: number = 0.15;
  public seed: number = 7;
  public impulseThreshold: number = 60;
  public maxLiveShards: number = 24;
  public sleepDelay: number = 4;
  public dustBurst: number = 12;
  public dustColor: string = '#b8a88f';

  public fractured: boolean = false;
  public fractureCount: number = 0;

  private contactArmed: boolean = false;

  constructor(options?: DestructibleOptions) {
    super();
    if (options) {
      if (options.shardGrid) this.shardGrid = [...options.shardGrid] as [number, number, number];
      if (options.shardJitter !== undefined) this.shardJitter = Math.min(0.49, Math.max(0, options.shardJitter));
      if (options.seed !== undefined) this.seed = options.seed;
      if (options.impulseThreshold !== undefined) this.impulseThreshold = Math.max(0, options.impulseThreshold);
      if (options.maxLiveShards !== undefined) this.maxLiveShards = Math.max(1, Math.floor(options.maxLiveShards));
      if (options.sleepDelay !== undefined) this.sleepDelay = Math.max(0, options.sleepDelay);
      if (options.dustBurst !== undefined) this.dustBurst = Math.max(0, Math.floor(options.dustBurst));
      if (options.dustColor !== undefined) this.dustColor = options.dustColor;
    }
  }

  public override start(): void {
    this.ensureContactEvents();
  }

  /** Idempotent: safe to call every frame (covers post-build attachment). */
  private ensureContactEvents(): void {
    if (this.contactArmed) return;
    let live = false;
    for (const collider of this.gameObject.getComponents(Collider3D)) {
      collider.contactEvents = true;
      if (collider.contactThreshold > this.impulseThreshold) {
        collider.contactThreshold = this.impulseThreshold;
      }
      const rapierCollider = collider.rapierCollider;
      if (rapierCollider) {
        live = true;
        try {
          (rapierCollider as unknown as {
            setActiveEvents: (e: number) => void;
            setContactForceEventThreshold: (t: number) => void;
          }).setActiveEvents(2);
          (rapierCollider as unknown as {
            setActiveEvents: (e: number) => void;
            setContactForceEventThreshold: (t: number) => void;
          }).setContactForceEventThreshold(collider.contactThreshold);
        } catch {
          /* headless without physics */
        }
      }
    }
    if (live) this.contactArmed = true;
  }

  public override update(_deltaTime: number): void {
    // Backstop for components attached after physics init (runner path).
    this.ensureContactEvents();
  }

  /** Owner mesh size (MeshRenderer size, fallback unit box). */
  public ownerSize(): [number, number, number] {
    const mesh = this.gameObject.getComponent(MeshRenderer);
    if (mesh) return [mesh.size[0], mesh.size[1], mesh.size[2]];
    return [1, 1, 1];
  }

  /** Fracture now (threshold dispatch calls this with the impact impulse). */
  public fracture(impulse: number, at?: [number, number, number]): GameObject[] {
    if (this.fractured) return [];
    this.fractured = true;
    this.fractureCount++;
    const scene = this.gameObject.scene;
    const owner = this.gameObject.transform.position;
    const ownerColor = this.gameObject.getComponent(MeshRenderer)?.color ?? '#9ca3af';
    const ownerWorld = this.gameObject.getComponent(RigidBody3D)?.world ?? null;
    const specs = shardPattern(this.ownerSize(), this.shardGrid, this.shardJitter, this.seed);
    const spawned: GameObject[] = [];
    const magnitude = Math.min(12, 2 + impulse / 20);
    const rand = lcg(this.seed + this.fractureCount);
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const go = new GameObject(`${this.gameObject.name}_shard_${this.fractureCount}_${i}`);
      go.transform.setPosition(owner.x + spec.offset[0], owner.y + spec.offset[1], owner.z + spec.offset[2]);
      go.addComponent(new MeshRenderer({ shape: 'box', size: [...spec.size] as [number, number, number], color: ownerColor }));
      const body = go.addComponent(new RigidBody3D({ bodyType: 'dynamic', mass: 0.5 }));
      go.addComponent(new Collider3D({ shape: 'box', size: [...spec.size] as [number, number, number] }));
      if (scene) scene.addGameObject(go);
      if (ownerWorld) {
        body.initPhysics(ownerWorld);
        // Outward burst + slight random spread, scaled by impact.
        const dir = [spec.offset[0], spec.offset[1] + 0.5, spec.offset[2]];
        const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        const jitter = 0.7 + rand() * 0.6;
        body.setLinearVelocity(
          (dir[0] / len) * magnitude * jitter,
          (dir[1] / len) * magnitude * jitter,
          (dir[2] / len) * magnitude * jitter
        );
      }
      spawned.push(go);
      getDestructionPool().trackShard(go, body, this.sleepDelay, this.maxLiveShards);
    }
    // Park the intact owner (kept for undo restore, not simulated).
    this.gameObject.active = false;
    const ownerBody = this.gameObject.getComponent(RigidBody3D);
    if (ownerBody?.rapierBody) {
      try {
        ownerBody.rapierBody.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      } catch {
        try {
          ownerBody.rapierBody.sleep();
        } catch {
          /* headless without physics */
        }
      }
    }
    this.emitDust(at ?? [owner.x, owner.y, owner.z], impulse);
    return spawned;
  }

  private emitDust(at: [number, number, number], impulse: number): void {
    if (this.dustBurst <= 0) return;
    const scene = this.gameObject.scene;
    if (!scene) return;
    let emitter = this.gameObject.getComponent(ParticleSystem);
    if (!emitter) {
      const dust = new GameObject(`${this.gameObject.name}_dust`);
      dust.transform.setPosition(at[0], at[1], at[2]);
      emitter = dust.addComponent(
        new ParticleSystem({
          rate: 0,
          maxParticles: 128,
          shape: 'sphere',
          shapeSize: [0.6, 0.6, 0.6],
          direction: [0, 1, 0],
          spread: 1.1,
          speedMin: 1,
          speedMax: 3,
          gravity: -1.5,
          lifetimeMin: 0.5,
          lifetimeMax: 1.2,
          sizeMin: 0.15,
          sizeMax: 0.4,
          startColor: this.dustColor,
          endColor: this.dustColor,
          opacity: 0.7,
          seed: this.seed
        })
      );
      scene.addGameObject(dust);
    }
    emitter.emit(Math.min(128, Math.floor(this.dustBurst * (1 + impulse / 100))));
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'Destructible',
      enabled: this.enabled,
      shardGrid: [...this.shardGrid],
      shardJitter: this.shardJitter,
      seed: this.seed,
      impulseThreshold: this.impulseThreshold,
      maxLiveShards: this.maxLiveShards,
      sleepDelay: this.sleepDelay,
      dustBurst: this.dustBurst,
      dustColor: this.dustColor,
      fractured: this.fractured,
      fractureCount: this.fractureCount
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (Array.isArray(data.shardGrid)) this.shardGrid = [data.shardGrid[0] ?? 2, data.shardGrid[1] ?? 2, data.shardGrid[2] ?? 2];
    if (typeof data.shardJitter === 'number') this.shardJitter = data.shardJitter;
    if (typeof data.seed === 'number') this.seed = data.seed;
    if (typeof data.impulseThreshold === 'number') this.impulseThreshold = data.impulseThreshold;
    if (typeof data.maxLiveShards === 'number') this.maxLiveShards = data.maxLiveShards;
    if (typeof data.sleepDelay === 'number') this.sleepDelay = data.sleepDelay;
    if (typeof data.dustBurst === 'number') this.dustBurst = data.dustBurst;
    if (typeof data.dustColor === 'string') this.dustColor = data.dustColor;
    if (typeof data.fractured === 'boolean') this.fractured = data.fractured;
    if (typeof data.fractureCount === 'number') this.fractureCount = data.fractureCount;
  }
}

/**
 * DestructionPool — impulse dispatch + shard lifecycle (shared default like
 * getAudioManager; tests swap their own via setDestructionPool).
 */
export class DestructionPool {
  /** Hard cap on live dynamic shards (oldest merge early past it). */
  public maxLiveShards: number = 24;

  private shards: TrackedShard[] = [];
  private world: PhysicsWorld | null = null;

  /** Binds the physics world (enables its contact-force queue). */
  public attachWorld(world: PhysicsWorld | null): void {
    this.world = world;
    world?.enableContactForces();
  }

  public trackShard(go: GameObject, body: RigidBody3D, sleepDelay: number, maxLive: number): void {
    this.shards.push({ go, body, sleepDelay, sleepTimer: sleepDelay, maxLive, merged: false });
  }

  public get liveShards(): number {
    return this.shards.filter(s => !s.merged).length;
  }

  public get mergedShards(): number {
    return this.shards.filter(s => s.merged).length;
  }

  public reset(): void {
    this.shards = [];
  }

  /**
   * Per-frame: dispatches contact forces to destructibles at/over threshold
   * and advances shard sleep/merge budgets. No world bound (or contact
   * forces disabled) still advances lifecycle timers against body sleep
   * state — headless runs without physics merge on the sleeping default.
   */
  public update(deltaTime: number): void {
    if (this.world?.contactForcesEnabled) {
      const forces = this.world.drainContactForces();
      const hits = new Map<Destructible, number>();
      for (const force of forces) {
        for (const handle of [force.colliderA, force.colliderB]) {
          const owner = this.world.gameObjectForCollider(handle);
          if (!owner || typeof owner !== 'object') continue;
          const destructible = (owner as GameObject).getComponent(Destructible);
          if (destructible && !destructible.fractured) {
            const prev = hits.get(destructible) ?? 0;
            if (force.totalForce > prev) hits.set(destructible, force.totalForce);
          }
        }
      }
      for (const [destructible, impulse] of hits) {
        if (impulse >= destructible.impulseThreshold) {
          destructible.fracture(impulse);
        }
      }
    }
    // Lifecycle: sleeping shards count down to static merge...
    for (const shard of this.shards) {
      if (shard.merged) continue;
      const rapierBody = shard.body.rapierBody;
      const sleeping = rapierBody ? safeIsSleeping(rapierBody) : true;
      if (sleeping) {
        shard.sleepTimer -= deltaTime;
        if (shard.sleepTimer <= 0) mergeShard(shard);
      } else {
        shard.sleepTimer = shard.sleepDelay;
      }
    }
    // ...and the live cap merges oldest first: pool cap authoritative,
    // per-shard caps only tighten. All unmerged shards count toward the
    // rubble budget, physics-backed or not.
    const live = this.shards.filter(s => !s.merged);
    const cap = live.reduce((m, s) => Math.min(m, s.maxLive), this.maxLiveShards);
    let over = live.length - cap;
    for (const shard of live) {
      if (over <= 0) break;
      mergeShard(shard);
      over--;
    }
  }
}

function safeIsSleeping(body: { isSleeping?: () => boolean }): boolean {
  try {
    return body.isSleeping ? body.isSleeping() : true;
  } catch {
    return true;
  }
}

function mergeShard(shard: TrackedShard): void {
  shard.merged = true;
  const rapierBody = shard.body.rapierBody;
  if (rapierBody) {
    try {
      rapierBody.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    } catch {
      try {
        rapierBody.sleep();
      } catch {
        /* headless without physics */
      }
    }
  }
}

let defaultPool: DestructionPool | null = null;

/** Shared pool (tests swap their own via setDestructionPool). */
export function getDestructionPool(): DestructionPool {
  if (!defaultPool) defaultPool = new DestructionPool();
  return defaultPool;
}

export function setDestructionPool(pool: DestructionPool | null): void {
  defaultPool = pool;
}
