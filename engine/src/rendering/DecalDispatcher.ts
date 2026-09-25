import { Component } from '../core/Component.js';

/**
 * DecalDispatcher — impact decal registry for the FPS genre.
 *
 * Consumes weapon hit events (structurally typed `{ point, normal }`, so this
 * rendering-layer component never imports weapons/ — Strict Decoupling) and
 * maintains a capped, time-expiring decal list with fade-out. The renderer (or
 * a QA scenario) reads `getDecals()`; nothing here requires a GPU, so it runs
 * headless in tests and the Android container alike.
 */

export interface DecalInput {
  point: [number, number, number];
  normal: [number, number, number] | null;
}

export interface DecalOptions {
  size?: number;
  ttl?: number;
  color?: string;
}

export interface DecalRecord {
  id: string;
  position: [number, number, number];
  normal: [number, number, number];
  size: number;
  color: string;
  age: number;
  ttl: number;
  opacity: number;
}

export class DecalDispatcher extends Component {
  /** Maximum simultaneous decals (oldest evicted first). */
  public maxDecals: number = 64;
  public defaultSize: number = 0.5;
  public defaultTtl: number = 30;
  public defaultColor: string = '#0f0f0f';

  private decals: DecalRecord[] = [];
  private nextId = 0;

  /** Registers an impact decal, evicting the oldest record when at capacity. */
  public addDecal(input: DecalInput, options: DecalOptions = {}): DecalRecord {
    const record: DecalRecord = {
      id: `decal_${this.nextId++}`,
      position: [input.point[0], input.point[1], input.point[2]],
      normal: input.normal ? [input.normal[0], input.normal[1], input.normal[2]] : [0, 1, 0],
      size: options.size ?? this.defaultSize,
      color: options.color ?? this.defaultColor,
      age: 0,
      ttl: options.ttl ?? this.defaultTtl,
      opacity: 1
    };
    this.decals.push(record);
    while (this.decals.length > this.maxDecals) {
      this.decals.shift();
    }
    return record;
  }

  /** Ages decals and fades opacity over the final 25% of their lifetime. */
  public override update(dt: number): void {
    for (const decal of this.decals) {
      decal.age += dt;
      const remaining = decal.ttl - decal.age;
      decal.opacity = remaining <= 0 ? 0 : Math.min(1, remaining / (decal.ttl * 0.25));
    }
    this.decals = this.decals.filter(d => d.age < d.ttl);
  }

  public getDecals(): readonly DecalRecord[] {
    return this.decals;
  }

  public get count(): number {
    return this.decals.length;
  }

  public clear(): void {
    this.decals = [];
  }
}
