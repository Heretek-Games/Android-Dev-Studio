/**
 * HealthComponent — hit points with a damage/invulnerability window and death events.
 *
 * Headless-testable (no rendering/physics coupling); weapons call `takeDamage`
 * from their hit events and the game session subscribes to `onDeath`.
 */

import { Component } from '../core/Component.js';

export interface HealthOptions {
  maxHealth?: number;
  /** Start at less than max (e.g. mid-level restore). */
  health?: number;
  /** Seconds of immunity after each damage application (0 = always vulnerable). */
  invulnerabilitySeconds?: number;
  /** Destroy the GameObject when health reaches zero (default true). */
  destroyOnDeath?: boolean;
}

export interface DamageEvent {
  amount: number;
  remaining: number;
  source: unknown;
}

export class HealthComponent extends Component {
  public maxHealth: number;
  public health: number;
  public invulnerabilitySeconds: number;
  public destroyOnDeath: boolean;

  private invulnerableFor = 0;
  private readonly deathListeners = new Set<() => void>();
  private readonly damageListeners = new Set<(event: DamageEvent) => void>();

  constructor(options: HealthOptions = {}) {
    super();
    this.maxHealth = options.maxHealth ?? 100;
    this.health = options.health ?? this.maxHealth;
    this.invulnerabilitySeconds = options.invulnerabilitySeconds ?? 0;
    this.destroyOnDeath = options.destroyOnDeath ?? true;
  }

  public get isDead(): boolean {
    return this.health <= 0;
  }

  public get healthFraction(): number {
    return this.maxHealth > 0 ? Math.max(0, Math.min(1, this.health / this.maxHealth)) : 0;
  }

  public get isInvulnerable(): boolean {
    return this.invulnerableFor > 0;
  }

  public override update(deltaTime: number): void {
    if (this.invulnerableFor > 0) this.invulnerableFor = Math.max(0, this.invulnerableFor - deltaTime);
  }

  /** Apply damage; returns the amount actually applied (0 while invulnerable/dead). */
  public takeDamage(amount: number, source: unknown = null): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    if (this.isDead || this.isInvulnerable) return 0;

    const applied = Math.min(this.health, amount);
    this.health -= applied;
    if (this.invulnerabilitySeconds > 0 && !this.isDead) {
      this.invulnerableFor = this.invulnerabilitySeconds;
    }
    const event: DamageEvent = { amount: applied, remaining: this.health, source };
    for (const listener of this.damageListeners) listener(event);

    if (this.isDead) {
      for (const listener of this.deathListeners) listener();
      if (this.destroyOnDeath) this.gameObject.destroy();
    }
    return applied;
  }

  /** Heal; returns the amount actually restored. */
  public heal(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0 || this.isDead) return 0;
    const restored = Math.min(this.maxHealth - this.health, amount);
    this.health += restored;
    return restored;
  }

  public onDeath(listener: () => void): () => void {
    this.deathListeners.add(listener);
    return () => this.deathListeners.delete(listener);
  }

  public onDamage(listener: (event: DamageEvent) => void): () => void {
    this.damageListeners.add(listener);
    return () => this.damageListeners.delete(listener);
  }

  public override onDestroy(): void {
    this.deathListeners.clear();
    this.damageListeners.clear();
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'HealthComponent',
      enabled: this.enabled,
      maxHealth: this.maxHealth,
      health: this.health,
      invulnerabilitySeconds: this.invulnerabilitySeconds,
      destroyOnDeath: this.destroyOnDeath
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (data.maxHealth !== undefined) this.maxHealth = data.maxHealth;
    if (data.health !== undefined) this.health = data.health;
    if (data.invulnerabilitySeconds !== undefined) {
      this.invulnerabilitySeconds = data.invulnerabilitySeconds;
    }
    if (data.destroyOnDeath !== undefined) this.destroyOnDeath = data.destroyOnDeath;
  }
}
