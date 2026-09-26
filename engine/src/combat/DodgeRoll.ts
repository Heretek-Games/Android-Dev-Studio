import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { Hurtbox } from './Hurtbox.js';

export interface DodgeOptions {
  /** Roll distance in world units. */
  distance?: number;
  /** Roll duration in seconds. */
  duration?: number;
  /** Cooldown before the next dodge. */
  cooldownSeconds?: number;
}

/**
 * DodgeRoll — directional dodge with i-frames (Track E.2).
 *
 * Moves the owner along a facing-relative direction over `duration` while
 * granting Hurtbox invulnerability for the same window, then enforces a
 * cooldown. Facing comes from the owner's transform (matches MeleeHitbox).
 */
export class DodgeRoll extends Component {
  public distance: number = 4;
  public duration: number = 0.35;
  public cooldownSeconds: number = 0.8;

  private activeTime: number = -1;
  private cooldownLeft: number = 0;
  private readonly direction = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();

  constructor(options?: DodgeOptions) {
    super();
    if (options?.distance !== undefined) this.distance = options.distance;
    if (options?.duration !== undefined) this.duration = Math.max(0.01, options.duration);
    if (options?.cooldownSeconds !== undefined) {
      this.cooldownSeconds = Math.max(0, options.cooldownSeconds);
    }
  }

  public get dodging(): boolean {
    return this.activeTime >= 0;
  }

  public get cooldownFraction(): number {
    if (this.cooldownSeconds <= 0) return 0;
    return Math.min(1, Math.max(0, this.cooldownLeft / this.cooldownSeconds));
  }

  /**
   * Dodge along `direction` (world XZ; normalized internally). Returns false
   * when mid-roll or cooling down. Grants i-frames for the roll duration.
   */
  public dodge(dx: number, dz: number): boolean {
    if (this.dodging || this.cooldownLeft > 0) return false;
    this.direction.set(dx, 0, dz);
    if (this.direction.lengthSq() < 1e-8) return false;
    this.direction.normalize();
    this.origin.copy(this.gameObject.transform.position);
    this.activeTime = 0;
    this.cooldownLeft = this.cooldownSeconds;
    this.gameObject.getComponent(Hurtbox)?.grantInvuln(this.duration);
    return true;
  }

  public override update(deltaTime: number): void {
    if (this.cooldownLeft > 0) {
      this.cooldownLeft = Math.max(0, this.cooldownLeft - deltaTime);
    }
    if (this.activeTime < 0) return;
    this.activeTime += deltaTime;
    const t = Math.min(1, this.activeTime / this.duration);
    // Ease-out displacement: fast start, soft landing.
    const eased = 1 - (1 - t) * (1 - t);
    const pos = this.gameObject.transform.position;
    pos.x = this.origin.x + this.direction.x * this.distance * eased;
    pos.z = this.origin.z + this.direction.z * this.distance * eased;
    if (t >= 1) this.activeTime = -1;
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'DodgeRoll',
      enabled: this.enabled,
      distance: this.distance,
      duration: this.duration,
      cooldownSeconds: this.cooldownSeconds
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.distance !== undefined) this.distance = data.distance;
    if (data.duration !== undefined) this.duration = data.duration;
    if (data.cooldownSeconds !== undefined) this.cooldownSeconds = data.cooldownSeconds;
  }
}
