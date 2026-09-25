import { Component } from '../core/Component.js';
import { GameObject } from '../core/GameObject.js';
import { MeshRenderer, type PrimitiveShape } from '../components/MeshRenderer.js';

export interface SpawnTemplate {
  shape?: PrimitiveShape;
  size?: [number, number, number];
  color?: string;
}

export interface SpawnerOptions {
  template?: SpawnTemplate;
  /** Seconds between spawns. Default 1. */
  interval?: number;
  /** Total spawn cap (0 = unlimited). Default 0. */
  maxSpawns?: number;
  /** Golden-angle ring radius around the spawn point. Default 0. */
  spawnRadius?: number;
  /** Base offset from the owner position. Default [0, 0, 0]. */
  spawnOffset?: [number, number, number];
  /** Start emitting on attach. Default true. */
  autostart?: boolean;
}

/** Golden angle: successive spawns spread evenly with zero stored state. */
const GOLDEN_ANGLE = 2.399963229728653;

/** Boundary tolerance for IEEE754 accumulation (see update). */
const EPSILON = 1e-9;

/**
 * Spawner behavior (Track 1.3 behavior library, GDevelop/Unity-informed).
 *
 * Timed object factory: every `interval` seconds it instantiates a
 * MeshRenderer copy of `template` into the live scene (Unity
 * Instantiate / GDevelop "create object" semantics). Placement is a
 * deterministic golden-angle ring, so headless runs replay exactly with
 * no RNG state to serialize. `maxSpawns` caps lifetime output
 * (pair with DestroyOutsideScreen for alive-caps).
 */
export class Spawner extends Component {
  public template: Required<SpawnTemplate> = {
    shape: 'box',
    size: [0.5, 0.5, 0.5],
    color: '#f59e0b'
  };
  public interval: number = 1.0;
  public maxSpawns: number = 0;
  public spawnRadius: number = 0;
  public spawnOffset: [number, number, number] = [0, 0, 0];
  public running: boolean = true;

  public spawnedCount: number = 0;
  public elapsed: number = 0;

  constructor(options?: SpawnerOptions) {
    super();
    if (options) {
      if (options.template !== undefined) {
        const t = options.template;
        if (t.shape !== undefined) this.template.shape = t.shape;
        if (t.size !== undefined) this.template.size = [t.size[0], t.size[1], t.size[2]];
        if (t.color !== undefined) this.template.color = t.color;
      }
      if (options.interval !== undefined) this.interval = Math.max(0.0001, options.interval);
      if (options.maxSpawns !== undefined) this.maxSpawns = Math.max(0, Math.floor(options.maxSpawns));
      if (options.spawnRadius !== undefined) this.spawnRadius = Math.max(0, options.spawnRadius);
      if (options.spawnOffset !== undefined) this.spawnOffset = [...options.spawnOffset] as [number, number, number];
      if (options.autostart !== undefined) this.running = options.autostart;
    }
  }

  /**
   * Resumes emission. Named play()/pause() (not start()/stop()) because
   * Component.start() is the engine attach-lifecycle hook — overriding it
   * would let Scene.addGameObject force autostart:false spawners back on.
   */
  public play(): void {
    this.running = true;
  }

  public pause(): void {
    this.running = false;
  }

  public reset(): void {
    this.elapsed = 0;
    this.spawnedCount = 0;
    this.running = true;
  }

  public override update(deltaTime: number): void {
    if (!this.running) return;
    if (this.maxSpawns > 0 && this.spawnedCount >= this.maxSpawns) return;
    this.elapsed += deltaTime;
    while (this.elapsed + EPSILON >= this.interval) {
      if (this.maxSpawns > 0 && this.spawnedCount >= this.maxSpawns) {
        this.elapsed = 0;
        return;
      }
      this.elapsed -= this.interval;
      this.spawn();
    }
  }

  /** Instantiates one template copy now; returns the new GameObject (or null when capped/detached). */
  public spawn(): GameObject | null {
    const scene = this.gameObject?.scene;
    if (!scene) return null;
    if (this.maxSpawns > 0 && this.spawnedCount >= this.maxSpawns) return null;
    const index = this.spawnedCount;
    const owner = this.gameObject.transform.position;
    const angle = index * GOLDEN_ANGLE;
    const go = new GameObject(`${this.gameObject.name}_spawn_${index}`);
    go.transform.setPosition(
      owner.x + this.spawnOffset[0] + Math.cos(angle) * this.spawnRadius,
      owner.y + this.spawnOffset[1],
      owner.z + this.spawnOffset[2] + Math.sin(angle) * this.spawnRadius
    );
    go.addComponent(
      new MeshRenderer({
        shape: this.template.shape,
        size: [this.template.size[0], this.template.size[1], this.template.size[2]],
        color: this.template.color
      })
    );
    scene.addGameObject(go);
    this.spawnedCount++;
    return go;
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'Spawner',
      enabled: this.enabled,
      template: {
        shape: this.template.shape,
        size: [...this.template.size],
        color: this.template.color
      },
      interval: this.interval,
      maxSpawns: this.maxSpawns,
      spawnRadius: this.spawnRadius,
      spawnOffset: [...this.spawnOffset],
      running: this.running,
      spawnedCount: this.spawnedCount,
      elapsed: this.elapsed
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (data.template !== undefined) {
      if (data.template.shape !== undefined) this.template.shape = data.template.shape;
      if (data.template.size !== undefined) {
        this.template.size = [data.template.size[0], data.template.size[1], data.template.size[2]];
      }
      if (data.template.color !== undefined) this.template.color = data.template.color;
    }
    if (data.interval !== undefined) this.interval = data.interval;
    if (data.maxSpawns !== undefined) this.maxSpawns = data.maxSpawns;
    if (data.spawnRadius !== undefined) this.spawnRadius = data.spawnRadius;
    if (data.spawnOffset !== undefined) {
      this.spawnOffset = [data.spawnOffset[0], data.spawnOffset[1], data.spawnOffset[2]];
    }
    if (data.running !== undefined) this.running = data.running;
    if (data.spawnedCount !== undefined) this.spawnedCount = data.spawnedCount;
    if (data.elapsed !== undefined) this.elapsed = data.elapsed;
  }
}
