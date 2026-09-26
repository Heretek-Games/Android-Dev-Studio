import type { GameObject } from '../core/GameObject.js';
import { Component } from '../core/Component.js';
import { HealthComponent } from '../components/HealthComponent.js';

export interface HurtboxOptions {
  /** Invulnerability duration in seconds after a hit lands (i-frames). */
  invulnSeconds?: number;
}

export interface HurtResult {
  applied: number;
  blocked: boolean;
  reason: 'hit' | 'invulnerable' | 'no-health' | 'destroyed';
}

/**
 * Hurtbox — damage sink with invulnerability frames (Track E.2, ADR-1790433600001).
 *
 * Godot Area3D-hurtbox pattern adapted: the hurtbox, not the attacker,
 * decides whether a hit lands. Delegates health to the sibling
 * HealthComponent; missing health fails explicitly (no silent absorb).
 */
export class Hurtbox extends Component {
  public invulnSeconds: number = 0.5;

  private invulnUntil: number = -Infinity;
  private time: number = 0;

  constructor(options?: HurtboxOptions) {
    super();
    if (options?.invulnSeconds !== undefined) this.invulnSeconds = options.invulnSeconds;
  }

  public override update(deltaTime: number): void {
    this.time += deltaTime;
  }

  public get invulnerable(): boolean {
    return this.time < this.invulnUntil;
  }

  /** Grant i-frames directly (dodge rolls, spawn protection). */
  public grantInvuln(seconds?: number): void {
    this.invulnUntil = this.time + (seconds ?? this.invulnSeconds);
  }

  public takeHit(damage: number, _source?: GameObject): HurtResult {
    if (!this.enabled || !this.gameObject.active) {
      return { applied: 0, blocked: true, reason: 'destroyed' };
    }
    if (this.invulnerable) {
      return { applied: 0, blocked: true, reason: 'invulnerable' };
    }
    const health = this.gameObject.getComponent(HealthComponent);
    if (!health) {
      return { applied: 0, blocked: true, reason: 'no-health' };
    }
    health.takeDamage(damage);
    this.invulnUntil = this.time + this.invulnSeconds;
    return { applied: damage, blocked: false, reason: 'hit' };
  }

  public override toJSON(): Record<string, any> {
    return { type: 'Hurtbox', enabled: this.enabled, invulnSeconds: this.invulnSeconds };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.invulnSeconds !== undefined) this.invulnSeconds = data.invulnSeconds;
  }
}
