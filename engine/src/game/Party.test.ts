import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { MobileController } from '../components/MobileController.js';
import { Party } from './Party.js';

function party(): { amber: GameObject; barbara: GameObject; diluc: GameObject; roster: Party } {
  const scene = new Scene('Party');
  const amber = new GameObject('Amber');
  amber.addComponent(new MobileController());
  const barbara = new GameObject('Barbara');
  barbara.addComponent(new MobileController());
  const diluc = new GameObject('Diluc');
  diluc.addComponent(new MobileController());
  scene.addGameObject(amber);
  scene.addGameObject(barbara);
  scene.addGameObject(diluc);
  const roster = new Party({ swapCooldownSeconds: 1.0 });
  roster.setMembers([amber, barbara, diluc]);
  return { amber, barbara, diluc, roster };
}

describe('Party — single-player control roster with swap', () => {
  test('active member holds the controller, companions keep AI brains', () => {
    const { amber, barbara, roster } = party();
    assert.strictEqual(roster.active()!.name, 'Amber');
    assert.strictEqual(amber.getComponent(MobileController)!.enabled, true);
    assert.strictEqual(barbara.getComponent(MobileController)!.enabled, false);
  });

  test('swap transfers control with cooldown and events', () => {
    const { barbara, roster } = party();
    const swaps: string[] = [];
    roster.onSwap((prev, next) => swaps.push(`${prev.name}->${next.name}`));
    assert.strictEqual(roster.swapTo(1), true);
    assert.strictEqual(roster.active()!.name, 'Barbara');
    assert.strictEqual(barbara.getComponent(MobileController)!.enabled, true);
    assert.deepStrictEqual(swaps, ['Amber->Barbara']);
    assert.strictEqual(roster.swapsTaken, 1);
    // Cooldown blocks the immediate swap-back.
    assert.strictEqual(roster.swapTo(0), false);
    for (let i = 0; i < 60; i++) roster.update(1 / 60);
    assert.strictEqual(roster.swapTo(0), true);
  });

  test('bad index and no-op swaps are rejected', () => {
    const { roster } = party();
    assert.strictEqual(roster.swapTo(-1), false);
    assert.strictEqual(roster.swapTo(9), false);
    assert.strictEqual(roster.swapTo(0), false);
    assert.strictEqual(roster.swapsTaken, 0);
  });

  test('empty roster is safe', () => {
    const roster = new Party();
    roster.setMembers([]);
    assert.strictEqual(roster.size, 0);
    assert.strictEqual(roster.active(), null);
    assert.strictEqual(roster.swapTo(0), false);
  });
});
