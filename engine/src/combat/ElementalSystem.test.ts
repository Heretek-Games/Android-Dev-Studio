import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GameObject } from '../core/GameObject.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { RigidBody3D } from '../components/RigidBody3D.js';
import { ElementalSystem } from './ElementalSystem.js';
import { ElementalReactionComponent } from './ElementalReactionComponent.js';

describe('Genshin Elemental Combat Engine', () => {
  it('applies elemental auras when no prior element exists', () => {
    const res = ElementalSystem.evaluateReaction(null, 'Pyro', 100, 1.0);
    assert.strictEqual(res.reactionResult.reaction, 'None');
    assert.strictEqual(res.remainingAura?.element, 'Pyro');
    assert.ok(res.remainingAura.gaugeUnits > 0);
  });

  it('triggers forward Vaporize with 2.0x damage on Hydro attacking Pyro', () => {
    // 1. Initial Pyro aura
    const { remainingAura } = ElementalSystem.evaluateReaction(null, 'Pyro', 100, 1.0);
    // 2. Incoming Hydro attack
    const reaction = ElementalSystem.evaluateReaction(remainingAura, 'Hydro', 100, 1.0);
    assert.strictEqual(reaction.reactionResult.reaction, 'Vaporize');
    assert.strictEqual(reaction.reactionResult.damageMultiplier, 2.0);
  });

  it('triggers Melt on Pyro attacking Cryo', () => {
    const { remainingAura } = ElementalSystem.evaluateReaction(null, 'Cryo', 100, 1.0);
    const reaction = ElementalSystem.evaluateReaction(remainingAura, 'Pyro', 100, 1.0);
    assert.strictEqual(reaction.reactionResult.reaction, 'Melt');
    assert.strictEqual(reaction.reactionResult.damageMultiplier, 2.0);
  });

  it('triggers Freeze and locks entity velocities', () => {
    const go = new GameObject('Slime');
    const comp = new ElementalReactionComponent();
    const rb = new RigidBody3D({ bodyType: 'dynamic' });
    const mesh = new MeshRenderer({ shape: 'sphere', color: '#10b981' });

    go.addComponent(mesh);
    go.addComponent(rb);
    go.addComponent(comp);
    comp.start();

    // 1. Apply Hydro
    comp.receiveElementalAttack('Hydro', 10, 1.0);
    assert.strictEqual(comp.currentAura?.element, 'Hydro');
    assert.strictEqual(comp.isFrozen, false);

    // 2. Apply Cryo -> Triggers Freeze
    const freezeRes = comp.receiveElementalAttack('Cryo', 20, 1.0);
    assert.strictEqual(freezeRes.reaction, 'Freeze');
    assert.strictEqual(comp.isFrozen, true);
    assert.ok(comp.freezeTimer > 0);

    // 3. Ticking deltaTime unfreezes after timer expires
    comp.update(comp.freezeTimer + 0.1);
    assert.strictEqual(comp.isFrozen, false);
  });

  it('triggers Overload with bonus damage and radial impulse', () => {
    const { remainingAura } = ElementalSystem.evaluateReaction(null, 'Electro', 100, 1.0);
    const reaction = ElementalSystem.evaluateReaction(remainingAura, 'Pyro', 100, 1.0);
    assert.strictEqual(reaction.reactionResult.reaction, 'Overload');
    assert.ok(reaction.reactionResult.bonusDamage > 0);
    assert.ok(reaction.reactionResult.radialImpulse && reaction.reactionResult.radialImpulse > 0);
  });

  it('triggers Swirl on Anemo hitting Pyro aura', () => {
    const { remainingAura } = ElementalSystem.evaluateReaction(null, 'Pyro', 100, 1.0);
    const reaction = ElementalSystem.evaluateReaction(remainingAura, 'Anemo', 100, 1.0);
    assert.strictEqual(reaction.reactionResult.reaction, 'Swirl');
    assert.strictEqual(reaction.reactionResult.swirlElement, 'Pyro');
  });
});
