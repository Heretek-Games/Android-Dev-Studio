/**
 * DamageRouter — routes weapon hit events to the hit entity's HealthComponent.
 *
 * Decouples weapons from health/game rules: any hit source (WeaponController,
 * an AI attack, a trap) that implements `onHit` can feed the router, and the
 * router reports kills back to the game session.
 */

import type { Scene } from '../core/Scene.js';
import { HealthComponent } from '../components/HealthComponent.js';

export interface HitEventLike {
  hitObjectName: string;
  damage: number;
}

export interface HitSource {
  onHit(listener: (event: HitEventLike) => void): () => void;
}

export interface DamageRouterOptions {
  /** Called when a hit kills the target (after HealthComponent death handling). */
  onKill?: (name: string, event: HitEventLike) => void;
  /** Called for every applied damage instance. */
  onDamage?: (name: string, applied: number, event: HitEventLike) => void;
}

/**
 * Subscribe a scene's health components to a hit source.
 * Returns a detach function (also stops routing).
 */
export function attachDamageRouter(scene: Scene, source: HitSource, options: DamageRouterOptions = {}): () => void {
  const unsubscribe = source.onHit((event) => {
    const target = scene.findByName(event.hitObjectName);
    if (!target) return;
    const health = target.getComponent(HealthComponent);
    if (!health) return;

    const applied = health.takeDamage(event.damage, event);
    if (applied <= 0) return;
    options.onDamage?.(event.hitObjectName, applied, event);
    if (health.isDead) options.onKill?.(event.hitObjectName, event);
  });
  return () => unsubscribe();
}
