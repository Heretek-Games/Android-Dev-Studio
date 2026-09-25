import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ElementalReactionComponent } from './ElementalReactionComponent.js';
import { GameObject } from '../core/GameObject.js';

describe('ElementalReactionComponent — auras, reactions, and status effects', () => {
  test('applies auras and amplifies damage through reactions (Vaporize)', () => {
    const go = new GameObject('Pyro Slime');
    const slime = go.addComponent(new ElementalReactionComponent({ baseElement: 'Pyro', maxHealth: 200 }));

    const result = slime.receiveElementalAttack('Hydro', 20, 1);
    assert.strictEqual(result.reaction, 'Vaporize');
    assert.strictEqual(result.damageMultiplier, 2);
    assert.strictEqual(slime.health, 200 - 40, 'vaporize doubles the damage');
    assert.strictEqual(slime.lastReaction?.reaction, 'Vaporize');
  });

  test('hydro + cryo triggers Freeze and locks the entity', () => {
    const go = new GameObject('Wet Slime');
    const slime = go.addComponent(new ElementalReactionComponent({ baseElement: 'Hydro', maxHealth: 100 }));

    const result = slime.receiveElementalAttack('Cryo', 10, 1);
    assert.strictEqual(result.reaction, 'Freeze');
    assert.strictEqual(slime.isFrozen, true);
    assert.ok(slime.freezeTimer > 0, 'freeze timer is armed');

    slime.update(10); // long tick past any freeze duration
    assert.strictEqual(slime.isFrozen, false, 'freeze expires over time');
  });

  test('same-element attacks build an aura without a reaction', () => {
    const go = new GameObject('Dry Slime');
    const slime = go.addComponent(new ElementalReactionComponent({ maxHealth: 100 }));

    const result = slime.receiveElementalAttack('Pyro', 10, 1);
    assert.strictEqual(result.reaction, 'None');
    assert.strictEqual(slime.currentAura?.element, 'Pyro');
    assert.strictEqual(slime.health, 90);
  });

  test('health floors at zero and serializes state', () => {
    const go = new GameObject('Frail');
    const slime = go.addComponent(new ElementalReactionComponent({ maxHealth: 15 }));
    slime.receiveElementalAttack('Electro', 100, 1);
    assert.strictEqual(slime.health, 0, 'health never goes negative');

    const json = slime.toJSON();
    assert.strictEqual(json.type, 'ElementalReactionComponent');
  });
});
