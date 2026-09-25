/**
 * DamageRouter — routes weapon hit events to the hit entity's HealthComponent.
 *
 * Decouples weapons from health/game rules: any hit source (WeaponController,
 * an AI attack, a trap) that implements `onHit` can feed the router, and the
 * router reports kills back to the game session.
 */

import type { Scene } from '../core/Scene.js';
import { HealthComponent } from '../components/HealthComponent.js';
import { ElementalReactionComponent } from '../combat/ElementalReactionComponent.js';
import type { ElementType, ReactionResult } from '../combat/ElementalSystem.js';

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
  /**
   * When set, hits apply this element through the target's
   * `ElementalReactionComponent` instead of the plain health path: reactions
   * (Vaporize, Melt, Freeze, Overload, …) scale the damage and trigger their
   * physics/visual effects, and the component's own health pool decides kills.
   */
  element?: ElementType;
  /** Elemental gauge units applied per hit (default 1.0). */
  gaugeUnits?: number;
  /** Called whenever a hit produces a non-trivial elemental reaction. */
  onReaction?: (name: string, reaction: ReactionResult) => void;
  /**
   * Remove the entity when its elemental health reaches zero (default true),
   * mirroring HealthComponent.destroyOnDeath so wave/clear logic sees the kill.
   */
  destroyOnElementalDeath?: boolean;
}

/**
 * Subscribe a scene's health components to a hit source.
 * Returns a detach function (also stops routing).
 */
export function attachDamageRouter(scene: Scene, source: HitSource, options: DamageRouterOptions = {}): () => void {
  const unsubscribe = source.onHit((event) => {
    const target = scene.findByName(event.hitObjectName);
    if (!target) return;

    // Elemental entities own their health pool: physical hits apply plain damage,
    // configured elements additionally drive auras/reactions.
    const elemental = target.getComponent(ElementalReactionComponent);
    if (elemental && !options.element) {
      const wasAlive = elemental.health > 0;
      const applied = Math.min(elemental.health, event.damage);
      elemental.health -= applied;
      if (applied > 0) options.onDamage?.(event.hitObjectName, applied, event);
      if (wasAlive && elemental.health <= 0) {
        options.onKill?.(event.hitObjectName, event);
        if (options.destroyOnElementalDeath ?? true) target.destroy();
      }
      return;
    }
    if (elemental) {
      const wasAlive = elemental.health > 0;
      const reaction = elemental.receiveElementalAttack(
        options.element!,
        event.damage,
        options.gaugeUnits ?? 1
      );
      if (reaction.reaction !== 'None') options.onReaction?.(event.hitObjectName, reaction);
      const applied = Math.max(0, event.damage * reaction.damageMultiplier + reaction.bonusDamage);
      if (applied > 0) options.onDamage?.(event.hitObjectName, applied, event);
      if (wasAlive && elemental.health <= 0) {
        options.onKill?.(event.hitObjectName, event);
        if (options.destroyOnElementalDeath ?? true) target.destroy();
      }
      return;
    }

    const health = target.getComponent(HealthComponent);
    if (!health) return;

    const applied = health.takeDamage(event.damage, event);
    if (applied <= 0) return;
    options.onDamage?.(event.hitObjectName, applied, event);
    if (health.isDead) options.onKill?.(event.hitObjectName, event);
  });
  return () => unsubscribe();
}
