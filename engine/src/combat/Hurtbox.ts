import type { GameObject } from '../core/GameObject.js';
import { Component } from '../core/Component.js';
import { HealthComponent } from '../components/HealthComponent.js';
import { ElementalReactionComponent } from './ElementalReactionComponent.js';
import type { ElementType } from './ElementalSystem.js';

export interface HurtboxOptions {
  /** Invulnerability duration in seconds after a hit lands (i-frames). */
  invulnSeconds?: number;
}

export interface HurtResult {
  applied: number;
  blocked: boolean;
  reason: 'hit' | 'invulnerable' | 'no-health' | 'destroyed';
  /** Non-'None' when an elemental reaction fired (elemental owners only). */
  reaction: string;
  /** True when this hit killed the owner. */
  fatal: boolean;
}

/** Resolution report for game-layer accounting (kills, reactions, numbers). */
export interface HurtResolution {
  targetName: string;
  applied: number;
  fatal: boolean;
  reaction: string;
}

/**
 * Hurtbox — damage sink with invulnerability frames (Track E.2, ADR-1790433600001).
 *
 * Godot Area3D-hurtbox pattern adapted: the hurtbox, not the attacker,
 * decides whether a hit lands. Delegates health to the sibling
 * HealthComponent — or to the sibling ElementalReactionComponent pool when
 * present (mirroring DamageRouter's elemental branch, same layer). Missing
 * health fails explicitly (no silent absorb). Game-layer accounting (kills,
 * reactions, damage numbers) subscribes via onResolved.
 */
export class Hurtbox extends Component {
  public invulnSeconds: number = 0.5;

  private invulnUntil: number = -Infinity;
  private time: number = 0;
  private resolvedListeners: Set<(resolution: HurtResolution) => void> = new Set();

  constructor(options?: HurtboxOptions) {
    super();
    if (options?.invulnSeconds !== undefined) this.invulnSeconds = options.invulnSeconds;
  }

  /** Subscribe to landed-hit resolutions (game-layer kill/reaction accounting). */
  public onResolved(listener: (resolution: HurtResolution) => void): () => void {
    this.resolvedListeners.add(listener);
    return () => this.resolvedListeners.delete(listener);
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

  /**
   * Resolve one incoming hit. Elemental owners resolve through their
   * ElementalReactionComponent pool: hits carrying an element drive auras
   * and reactions (Genshin infusion semantics); element-less hits deal
   * plain physical damage to the same pool.
   */
  public takeHit(
    damage: number,
    _source?: GameObject,
    element?: ElementType,
    gaugeUnits: number = 1
  ): HurtResult {
    if (!this.enabled || !this.gameObject.active) {
      return { applied: 0, blocked: true, reason: 'destroyed', reaction: 'None', fatal: false };
    }
    if (this.invulnerable) {
      return { applied: 0, blocked: true, reason: 'invulnerable', reaction: 'None', fatal: false };
    }
    const elemental = this.gameObject.getComponent(ElementalReactionComponent);
    if (elemental) {
      return this.resolveElemental(elemental, damage, element, gaugeUnits);
    }
    const health = this.gameObject.getComponent(HealthComponent);
    if (!health) {
      return { applied: 0, blocked: true, reason: 'no-health', reaction: 'None', fatal: false };
    }
    const applied = health.takeDamage(damage);
    this.invulnUntil = this.time + this.invulnSeconds;
    const fatal = health.isDead;
    this.emitResolved(applied, fatal, 'None');
    return { applied, blocked: false, reason: 'hit', reaction: 'None', fatal };
  }

  private resolveElemental(
    elemental: ElementalReactionComponent,
    damage: number,
    element: ElementType | undefined,
    gaugeUnits: number
  ): HurtResult {
    let applied: number;
    let reaction = 'None';
    if (element) {
      const before = elemental.health;
      const result = elemental.receiveElementalAttack(element, damage, gaugeUnits);
      reaction = result.reaction;
      applied = Math.min(before, Math.max(0, damage * result.damageMultiplier + result.bonusDamage));
    } else {
      applied = Math.min(elemental.health, damage);
      elemental.health = Math.max(0, elemental.health - damage);
    }
    this.invulnUntil = this.time + this.invulnSeconds;
    const fatal = elemental.health <= 0;
    if (fatal) this.gameObject.destroy();
    this.emitResolved(applied, fatal, reaction);
    return { applied, blocked: false, reason: 'hit', reaction, fatal };
  }

  private emitResolved(applied: number, fatal: boolean, reaction: string): void {
    const resolution: HurtResolution = {
      targetName: this.gameObject.name,
      applied,
      fatal,
      reaction
    };
    for (const listener of this.resolvedListeners) {
      try {
        listener(resolution);
      } catch {
        // listener errors must never break the hit
      }
    }
  }

  public override toJSON(): Record<string, any> {
    return { type: 'Hurtbox', enabled: this.enabled, invulnSeconds: this.invulnSeconds };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.invulnSeconds !== undefined) this.invulnSeconds = data.invulnSeconds;
  }
}
