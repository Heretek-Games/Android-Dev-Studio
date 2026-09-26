import { test, describe } from 'node:test';
import assert from 'node:assert';
import { EnemyAI } from './EnemyAI.js';
import { HealthComponent } from './HealthComponent.js';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';

function arena(enemyPosition: [number, number, number] = [10, 0, 0], options = {}) {
  const scene = new Scene('Arena');
  const player = new GameObject('Player Hero');
  scene.addGameObject(player);
  const health = player.addComponent(new HealthComponent({ maxHealth: 100, destroyOnDeath: false }));

  const enemy = new GameObject('Enemy');
  enemy.transform.setPosition(enemyPosition[0], enemyPosition[1], enemyPosition[2]);
  scene.addGameObject(enemy);
  const ai = enemy.addComponent(new EnemyAI({ targetName: 'Player Hero', ...options }));
  return { scene, player, health, enemy, ai };
}

describe('EnemyAI — chase, attack, aggro', () => {
  test('chases the target when inside the aggro radius', () => {
    const { enemy, ai } = arena([10, 0, 0]);
    const before = enemy.transform.position.x;
    ai.update(0.5);
    assert.ok(enemy.transform.position.x < before, 'moved toward the player at x=0');
    assert.ok(Math.abs(enemy.transform.position.x - 10) > 0.5, 'actually moved');
  });

  test('does not move when the target is beyond the aggro radius', () => {
    const { enemy, ai } = arena([30, 0, 0], { aggroRange: 18 });
    ai.update(1);
    assert.strictEqual(enemy.transform.position.x, 30);
  });

  test('attacks when in range and respects the cooldown', () => {
    const { health, ai } = arena([1.5, 0, 0], { attackRange: 2.2, attackDamage: 15, attackIntervalSeconds: 1 });
    ai.update(0.1);
    assert.strictEqual(health.health, 85, 'first hit lands');
    assert.strictEqual(ai.attacksLanded, 1);

    ai.update(0.1);
    assert.strictEqual(health.health, 85, 'cooldown blocks the second hit');

    ai.update(1.0);
    assert.strictEqual(health.health, 70, 'cooldown elapsed: second hit lands');
    assert.strictEqual(ai.attacksLanded, 2);
  });

  test('does not attack without a HealthComponent on the target', () => {
    const scene = new Scene('Arena');
    const player = new GameObject('Player Hero');
    scene.addGameObject(player);
    const enemy = new GameObject('Enemy');
    enemy.transform.setPosition(1, 0, 0);
    scene.addGameObject(enemy);
    const ai = enemy.addComponent(new EnemyAI({ targetName: 'Player Hero' }));

    ai.update(0.1);
    assert.strictEqual(ai.attacksLanded, 0);
  });

  test('does nothing when the target is missing', () => {
    const scene = new Scene('Arena');
    const enemy = new GameObject('Enemy');
    enemy.transform.setPosition(5, 0, 0);
    scene.addGameObject(enemy);
    const ai = enemy.addComponent(new EnemyAI({ targetName: 'Ghost' }));
    ai.update(1);
    assert.strictEqual(enemy.transform.position.x, 5);
  });

  test('serializes its tuning fields', () => {
    const { ai } = arena([5, 0, 0], { moveSpeed: 4, attackDamage: 7 });
    const json = ai.toJSON();
    assert.strictEqual(json.type, 'EnemyAI');
    assert.strictEqual(json.moveSpeed, 4);
    assert.strictEqual(json.attackDamage, 7);
  });
});

describe('EnemyAI — retarget (E.6 aggro)', () => {
  test('retarget redirects attacks to the new hero', () => {
    const scene = new Scene('Swap');
    const oldHero = new GameObject('Adventurer');
    const oldHealth = oldHero.addComponent(new HealthComponent({ maxHealth: 100, destroyOnDeath: false }));
    scene.addGameObject(oldHero);
    const squire = new GameObject('Squire');
    const squireHealth = squire.addComponent(new HealthComponent({ maxHealth: 100, destroyOnDeath: false }));
    scene.addGameObject(squire);
    const enemy = new GameObject('Slime');
    enemy.transform.setPosition(1.5, 0, 0);
    scene.addGameObject(enemy);
    const ai = enemy.addComponent(
      new EnemyAI({ targetName: 'Adventurer', attackRange: 5, attackDamage: 10, attackIntervalSeconds: 0.5 })
    );
    ai.update(0.6);
    assert.strictEqual(oldHealth.health, 90);
    ai.retarget('Squire');
    assert.strictEqual(ai.targetName, 'Squire');
    ai.update(0.6);
    assert.strictEqual(squireHealth.health, 90);
    assert.strictEqual(oldHealth.health, 90); // benched hero catches a breath
  });

  test('retarget to the same name is a no-op', () => {
    const { ai } = arena([1.5, 0, 0]);
    const tree = (ai as unknown as { tree: unknown }).tree;
    ai.retarget('Player Hero');
    assert.strictEqual((ai as unknown as { tree: unknown }).tree, tree);
  });
});
