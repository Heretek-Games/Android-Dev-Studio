import * as THREE from 'three';
import type { GameObject } from '../core/GameObject.js';
import { Component } from '../core/Component.js';
import { Hurtbox } from './Hurtbox.js';
import type { ElementType } from './ElementalSystem.js';

export interface MeleeHit {
  targetName: string;
  damage: number;
  applied: number;
  point: [number, number, number];
  /** Non-'None' when the strike triggered an elemental reaction. */
  reaction: string;
  /** True when the strike killed the target. */
  fatal: boolean;
}

export interface MeleeHitboxOptions {
  damage?: number;
  /** Reach in world units. */
  range?: number;
  /** Full arc in degrees around facing (360 = radial). */
  arcDegrees?: number;
  /** Element carried by the strike (infusion); drives auras/reactions. */
  element?: ElementType;
  /** Elemental gauge units applied per strike (default 1.0). */
  gaugeUnits?: number;
}

/**
 * MeleeHitbox — animation-driven striking volume (Track E.2, ADR-1790433600001).
 *
 * Godot hitbox pattern adapted to headless math (no Area3D needed): the game
 * calls beginSwing() on active frames, then tryHit() resolves Hurtboxes in
 * range+arc with one-hit-per-swing semantics. Emits HitSource-compatible
 * events for DamageRouter kill/reaction accounting.
 */
export class MeleeHitbox extends Component {
  public damage: number = 25;
  public range: number = 2.5;
  public arcDegrees: number = 120;
  public element?: ElementType;
  public gaugeUnits: number = 1;

  private hitListeners: Set<(hit: MeleeHit) => void> = new Set();
  private swungTargets: Set<string> = new Set();
  private readonly forward = new THREE.Vector3();

  constructor(options?: MeleeHitboxOptions) {
    super();
    if (options?.damage !== undefined) this.damage = options.damage;
    if (options?.range !== undefined) this.range = options.range;
    if (options?.arcDegrees !== undefined) this.arcDegrees = options.arcDegrees;
    if (options?.element !== undefined) this.element = options.element;
    if (options?.gaugeUnits !== undefined) this.gaugeUnits = options.gaugeUnits;
  }

  public onHit(listener: (hit: MeleeHit) => void): () => void {
    this.hitListeners.add(listener);
    return () => this.hitListeners.delete(listener);
  }

  /** Open a new swing: clears the one-hit-per-swing set. */
  public beginSwing(): void {
    this.swungTargets.clear();
  }

  /** Resolve one strike against all Hurtboxes in range+arc. Returns hits. */
  public tryHit(): MeleeHit[] {
    const scene = this.gameObject.scene;
    if (!scene) return [];
    const owner = this.gameObject.transform.position;
    this.forward.set(0, 0, -1).applyQuaternion(this.gameObject.transform.quaternion);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-8) this.forward.set(0, 0, -1);
    this.forward.normalize();

    const hits: MeleeHit[] = [];
    const halfArc = ((this.arcDegrees / 2) * Math.PI) / 180;
    for (const target of scene.gameObjects) {
      if (target === this.gameObject) continue;
      if (this.swungTargets.has(target.name)) continue;
      const hurt = target.getComponent(Hurtbox);
      if (!hurt) continue;
      const dx = target.transform.position.x - owner.x;
      const dz = target.transform.position.z - owner.z;
      const dist = Math.hypot(dx, dz);
      if (dist > this.range) continue;
      if (this.arcDegrees < 360 && dist > 1e-6) {
        const angle = Math.acos(
          Math.min(1, Math.max(-1, (dx * this.forward.x + dz * this.forward.z) / dist)));
        if (angle > halfArc) continue;
      }
      const result = hurt.takeHit(this.damage, this.gameObject, this.element, this.gaugeUnits);
      if (result.blocked) continue;
      this.swungTargets.add(target.name);
      const hit: MeleeHit = {
        targetName: target.name,
        damage: this.damage,
        applied: result.applied,
        point: [target.transform.position.x, target.transform.position.y, target.transform.position.z],
        reaction: result.reaction,
        fatal: result.fatal
      };
      hits.push(hit);
      for (const listener of this.hitListeners) {
        try {
          listener(hit);
        } catch {
          // listener errors must never break the strike
        }
      }
    }
    return hits;
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'MeleeHitbox',
      enabled: this.enabled,
      damage: this.damage,
      range: this.range,
      arcDegrees: this.arcDegrees,
      ...(this.element !== undefined ? { element: this.element } : {}),
      gaugeUnits: this.gaugeUnits
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.damage !== undefined) this.damage = data.damage;
    if (data.range !== undefined) this.range = data.range;
    if (data.arcDegrees !== undefined) this.arcDegrees = data.arcDegrees;
    if (data.element !== undefined) this.element = data.element;
    if (data.gaugeUnits !== undefined) this.gaugeUnits = data.gaugeUnits;
  }
}
