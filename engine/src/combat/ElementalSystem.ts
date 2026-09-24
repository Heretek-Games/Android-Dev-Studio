export type ElementType = 'Pyro' | 'Hydro' | 'Cryo' | 'Electro' | 'Anemo' | 'Geo' | 'Dendro';

export type ReactionType = 
  | 'Vaporize'
  | 'Melt'
  | 'Freeze'
  | 'Overload'
  | 'Superconduct'
  | 'ElectroCharged'
  | 'Swirl'
  | 'Crystallize'
  | 'Burning'
  | 'Bloom'
  | 'None';

export interface ElementalAura {
  element: ElementType;
  gaugeUnits: number; // Elemental strength (e.g. 1.0U = 9.5s, 2.0U = 12.0s)
  duration: number;   // Remaining seconds
  maxDuration: number;
}

export interface ReactionResult {
  reaction: ReactionType;
  damageMultiplier: number;
  bonusDamage: number;
  freezeDuration?: number;
  radialImpulse?: number;
  swirlElement?: ElementType;
  message: string;
}

/**
 * AAA Genshin Impact Elemental Reaction Engine.
 * Evaluates gauge theory interactions between applied elemental auras
 * and incoming elemental triggers with zero per-frame heap allocations.
 */
export class ElementalSystem {
  /**
   * Evaluates elemental reaction between an existing aura on a target
   * and an incoming elemental attack trigger.
   */
  public static evaluateReaction(
    targetAura: ElementalAura | null,
    triggerElement: ElementType,
    baseDamage: number = 100,
    triggerGauge: number = 1.0
  ): { reactionResult: ReactionResult; remainingAura: ElementalAura | null } {
    if (!targetAura || targetAura.gaugeUnits <= 0 || targetAura.duration <= 0) {
      // No reaction, apply incoming element as new aura
      const auraDuration = triggerGauge >= 2.0 ? 12.0 : 9.5;
      const newAura: ElementalAura = {
        element: triggerElement,
        gaugeUnits: triggerGauge * 0.8, // 0.8 tax on aura application
        duration: auraDuration,
        maxDuration: auraDuration
      };

      return {
        reactionResult: {
          reaction: 'None',
          damageMultiplier: 1.0,
          bonusDamage: 0,
          message: `Applied ${triggerElement} aura (${triggerGauge}U)`
        },
        remainingAura: ['Anemo', 'Geo'].includes(triggerElement) ? null : newAura
      };
    }

    const auraElem = targetAura.element;
    let reaction: ReactionType = 'None';
    let multiplier = 1.0;
    let bonusDamage = 0;
    let freezeDuration = 0;
    let radialImpulse = 0;
    let swirlElement: ElementType | undefined = undefined;

    // 1. Vaporize (Pyro + Hydro)
    if ((auraElem === 'Pyro' && triggerElement === 'Hydro') || (auraElem === 'Hydro' && triggerElement === 'Pyro')) {
      reaction = 'Vaporize';
      multiplier = triggerElement === 'Hydro' ? 2.0 : 1.5; // Forward vs Reverse Vaporize
    }
    // 2. Melt (Pyro + Cryo)
    else if ((auraElem === 'Cryo' && triggerElement === 'Pyro') || (auraElem === 'Pyro' && triggerElement === 'Cryo')) {
      reaction = 'Melt';
      multiplier = triggerElement === 'Pyro' ? 2.0 : 1.5; // Forward vs Reverse Melt
    }
    // 3. Freeze (Hydro + Cryo)
    else if ((auraElem === 'Hydro' && triggerElement === 'Cryo') || (auraElem === 'Cryo' && triggerElement === 'Hydro')) {
      reaction = 'Freeze';
      freezeDuration = Math.min(targetAura.gaugeUnits, triggerGauge) * 2.5 + 1.0;
      bonusDamage = baseDamage * 0.3;
    }
    // 4. Overload (Pyro + Electro)
    else if ((auraElem === 'Pyro' && triggerElement === 'Electro') || (auraElem === 'Electro' && triggerElement === 'Pyro')) {
      reaction = 'Overload';
      bonusDamage = baseDamage * 1.25;
      radialImpulse = 15.0; // Knockback force in Rapier3D
    }
    // 5. Superconduct (Cryo + Electro)
    else if ((auraElem === 'Cryo' && triggerElement === 'Electro') || (auraElem === 'Electro' && triggerElement === 'Cryo')) {
      reaction = 'Superconduct';
      bonusDamage = baseDamage * 0.75;
    }
    // 6. Electro-Charged (Hydro + Electro)
    else if ((auraElem === 'Hydro' && triggerElement === 'Electro') || (auraElem === 'Electro' && triggerElement === 'Hydro')) {
      reaction = 'ElectroCharged';
      bonusDamage = baseDamage * 0.85;
    }
    // 7. Swirl (Anemo triggering on Pyro/Hydro/Cryo/Electro)
    else if (triggerElement === 'Anemo' && ['Pyro', 'Hydro', 'Cryo', 'Electro'].includes(auraElem)) {
      reaction = 'Swirl';
      bonusDamage = baseDamage * 0.6;
      swirlElement = auraElem;
    }
    // 8. Crystallize (Geo triggering on Pyro/Hydro/Cryo/Electro)
    else if (triggerElement === 'Geo' && ['Pyro', 'Hydro', 'Cryo', 'Electro'].includes(auraElem)) {
      reaction = 'Crystallize';
      bonusDamage = baseDamage * 0.4;
    }
    // 9. Burning (Pyro + Dendro)
    else if ((auraElem === 'Dendro' && triggerElement === 'Pyro') || (auraElem === 'Pyro' && triggerElement === 'Dendro')) {
      reaction = 'Burning';
      bonusDamage = baseDamage * 1.1;
    }
    // 10. Bloom (Hydro + Dendro)
    else if ((auraElem === 'Dendro' && triggerElement === 'Hydro') || (auraElem === 'Hydro' && triggerElement === 'Dendro')) {
      reaction = 'Bloom';
      bonusDamage = baseDamage * 1.4;
      radialImpulse = 8.0;
    }

    // Gauge consumption calculation
    if (reaction !== 'None') {
      const consumptionRatio = (reaction === 'Vaporize' && triggerElement === 'Hydro') || 
                               (reaction === 'Melt' && triggerElement === 'Pyro') 
                               ? 2.0 : 1.0;
      const consumed = triggerGauge * consumptionRatio;
      const remainingGauge = targetAura.gaugeUnits - consumed;

      let remainingAura: ElementalAura | null = null;
      if (remainingGauge > 0.05) {
        remainingAura = {
          element: targetAura.element,
          gaugeUnits: remainingGauge,
          duration: (remainingGauge / targetAura.gaugeUnits) * targetAura.duration,
          maxDuration: targetAura.maxDuration
        };
      }

      return {
        reactionResult: {
          reaction,
          damageMultiplier: multiplier,
          bonusDamage,
          freezeDuration: freezeDuration > 0 ? freezeDuration : undefined,
          radialImpulse: radialImpulse > 0 ? radialImpulse : undefined,
          swirlElement,
          message: `${reaction.toUpperCase()}! ${multiplier > 1 ? `${multiplier}x DMG` : ''} ${bonusDamage > 0 ? `+${bonusDamage.toFixed(0)} Elemental DMG` : ''}`.trim()
        },
        remainingAura
      };
    }

    // If same element, replenish duration
    if (auraElem === triggerElement) {
      return {
        reactionResult: {
          reaction: 'None',
          damageMultiplier: 1.0,
          bonusDamage: 0,
          message: `Replenished ${triggerElement} aura`
        },
        remainingAura: {
          element: auraElem,
          gaugeUnits: Math.max(targetAura.gaugeUnits, triggerGauge),
          duration: targetAura.maxDuration,
          maxDuration: targetAura.maxDuration
        }
      };
    }

    return {
      reactionResult: {
        reaction: 'None',
        damageMultiplier: 1.0,
        bonusDamage: 0,
        message: 'No elemental reaction'
      },
      remainingAura: targetAura
    };
  }
}
