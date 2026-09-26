import { Component } from '../core/Component.js';
import { RigidBody3D } from '../components/RigidBody3D.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import {
  ElementalSystem,
  ElementType,
  ElementalAura,
  ReactionResult
} from './ElementalSystem.js';

export interface ElementalReactionOptions {
  baseElement?: ElementType;
  maxHealth?: number;
}

/**
 * Combat component managing elemental auras, reactions (Vaporize, Melt, Freeze, Overload),
 * and physics status effects on entities.
 */
export class ElementalReactionComponent extends Component {
  public currentAura: ElementalAura | null = null;
  public health: number = 100;
  public maxHealth: number = 100;
  public isFrozen: boolean = false;
  public freezeTimer: number = 0;
  public lastReaction: ReactionResult | null = null;
  /**
   * Innate element (Track E.2-live-fix): slimes re-assert their affinity on
   * a pulse cadence after reactions consume it (Genshin aura ICD), so long
   * real-time fights never degrade into reaction-less sponges.
   */
  public innateElement: ElementType | null = null;
  /** Seconds between innate re-seeds (default 2.0, Genshin ICD cadence). */
  public innatePulseSeconds: number = 2.0;

  private originalColor: string = '';
  // Start at a full ICD so the first re-seed waits the whole cadence.
  private innatePulseLeft: number = 2.0;

  constructor(options?: ElementalReactionOptions) {
    super();
    if (options) {
      if (options.baseElement) {
        this.innateElement = options.baseElement;
        this.currentAura = {
          element: options.baseElement,
          gaugeUnits: 2.0,
          duration: 9999.0, // Permanent innate element (e.g. Slimes, Cryo Regisvine)
          maxDuration: 9999.0
        };
      }
      if (options.maxHealth) {
        this.health = options.maxHealth;
        this.maxHealth = options.maxHealth;
      }
      this.innatePulseLeft = this.innatePulseSeconds;
    }
  }

  public override start(): void {
    const mesh = this.gameObject.getComponent(MeshRenderer);
    if (mesh) {
      this.originalColor = mesh.color;
    }
  }

  public override update(deltaTime: number): void {
    // 1. Tick Freeze Duration
    if (this.isFrozen) {
      this.freezeTimer -= deltaTime;
      if (this.freezeTimer <= 0) {
        this.unfreeze();
      }
    }

    // 2. Tick Elemental Aura Decay
    if (this.currentAura && this.currentAura.duration < 9000) {
      this.currentAura.duration -= deltaTime;
      if (this.currentAura.duration <= 0) {
        this.currentAura = null;
        this.restoreVisualTint();
      }
    }

    // 3. Innate re-pulse: consumed affinities re-assert on ICD cadence.
    if (!this.currentAura && this.innateElement) {
      this.innatePulseLeft -= deltaTime;
      if (this.innatePulseLeft <= 0) {
        this.innatePulseLeft = this.innatePulseSeconds;
        this.currentAura = {
          element: this.innateElement,
          gaugeUnits: 2.0,
          duration: 9999.0,
          maxDuration: 9999.0
        };
        this.updateVisualTint();
      }
    }
  }

  /**
   * Applies an incoming elemental strike to this entity,
   * triggering reaction calculation and physics impacts.
   */
  public receiveElementalAttack(
    incomingElement: ElementType,
    baseDamage: number = 25,
    gaugeUnits: number = 1.0
  ): ReactionResult {
    const { reactionResult, remainingAura } = ElementalSystem.evaluateReaction(
      this.currentAura,
      incomingElement,
      baseDamage,
      gaugeUnits
    );

    this.currentAura = remainingAura;
    this.lastReaction = reactionResult;

    // Calculate total damage
    const totalDmg = (baseDamage * reactionResult.damageMultiplier) + reactionResult.bonusDamage;
    this.health = Math.max(0, this.health - totalDmg);

    // Physics effect: Freeze
    if (reactionResult.reaction === 'Freeze' && reactionResult.freezeDuration) {
      this.freeze(reactionResult.freezeDuration);
    }

    // Physics effect: Overload Radial Knockback Impulse
    if (reactionResult.reaction === 'Overload' && reactionResult.radialImpulse) {
      const rb = this.gameObject.getComponent(RigidBody3D);
      if (rb && rb.bodyType === 'dynamic') {
        // Apply upward and backward explosion vector
        rb.applyImpulse(0, reactionResult.radialImpulse * 0.7, -reactionResult.radialImpulse * 0.8);
      }
    }

    this.updateVisualTint();
    return reactionResult;
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'ElementalReactionComponent',
      enabled: this.enabled,
      health: this.health,
      maxHealth: this.maxHealth,
      ...(this.innateElement ? { innateElement: this.innateElement } : {}),
      aura: this.currentAura
        ? {
            element: this.currentAura.element,
            gaugeUnits: this.currentAura.gaugeUnits,
            duration: this.currentAura.duration,
            maxDuration: this.currentAura.maxDuration
          }
        : null
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (data.maxHealth !== undefined) this.maxHealth = data.maxHealth;
    if (data.health !== undefined) this.health = data.health;
    if (typeof data.innateElement === 'string') {
      this.innateElement = data.innateElement as ElementType;
    }
    // Restore the aura directly: re-seeding through receiveElementalAttack
    // would re-trigger reactions and damage, corrupting the snapshot.
    const aura = data.aura;
    if (aura && typeof aura.element === 'string') {
      this.currentAura = {
        element: aura.element,
        gaugeUnits: aura.gaugeUnits ?? 1,
        duration: aura.duration ?? 9.5,
        maxDuration: aura.maxDuration ?? 9.5
      };
    } else {
      this.currentAura = null;
    }
  }

  private freeze(duration: number): void {
    this.isFrozen = true;
    this.freezeTimer = duration;

    // Lock Rapier3D physics linear velocity while frozen
    const rb = this.gameObject.getComponent(RigidBody3D);
    if (rb) {
      rb.setLinearVelocity(0, 0, 0);
    }

    // Tint entity icy cyan
    const mesh = this.gameObject.getComponent(MeshRenderer);
    if (mesh) {
      mesh.color = '#38bdf8';
    }
  }

  private unfreeze(): void {
    this.isFrozen = false;
    this.freezeTimer = 0;
    this.restoreVisualTint();
  }

  private updateVisualTint(): void {
    const mesh = this.gameObject.getComponent(MeshRenderer);
    if (!mesh || this.isFrozen) return;

    if (!this.currentAura) {
      this.restoreVisualTint();
      return;
    }

    switch (this.currentAura.element) {
      case 'Pyro':
        mesh.color = '#f97316';
        break;
      case 'Hydro':
        mesh.color = '#3b82f6';
        break;
      case 'Cryo':
        mesh.color = '#7dd3fc';
        break;
      case 'Electro':
        mesh.color = '#a855f7';
        break;
      case 'Dendro':
        mesh.color = '#22c55e';
        break;
      case 'Geo':
        mesh.color = '#eab308';
        break;
      case 'Anemo':
        mesh.color = '#2dd4bf';
        break;
    }
  }

  private restoreVisualTint(): void {
    const mesh = this.gameObject.getComponent(MeshRenderer);
    if (mesh && this.originalColor) {
      mesh.color = this.originalColor;
    }
  }
}
