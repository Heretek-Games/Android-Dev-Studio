import { test, describe } from 'node:test';
import assert from 'node:assert';
import { HealthComponent } from './HealthComponent.js';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';

describe('HealthComponent — damage, invulnerability, death', () => {
  test('defaults to full health and takes damage', () => {
    const go = new GameObject('Enemy');
    const health = go.addComponent(new HealthComponent({ maxHealth: 100 }));
    assert.strictEqual(health.health, 100);
    assert.strictEqual(health.healthFraction, 1);
    assert.strictEqual(health.isDead, false);

    const applied = health.takeDamage(30);
    assert.strictEqual(applied, 30);
    assert.strictEqual(health.health, 70);
    assert.ok(Math.abs(health.healthFraction - 0.7) < 1e-9);
  });

  test('lethal damage fires death listeners and destroys the object', () => {
    const scene = new Scene('HealthScene');
    const go = new GameObject('Enemy');
    scene.addGameObject(go);
    const health = go.addComponent(new HealthComponent({ maxHealth: 50 }));
    let deaths = 0;
    health.onDeath(() => deaths++);

    const applied = health.takeDamage(500);
    assert.strictEqual(applied, 50, 'overkill is clamped to remaining health');
    assert.strictEqual(health.isDead, true);
    assert.strictEqual(deaths, 1);
    assert.strictEqual(scene.findByName('Enemy'), null, 'destroyOnDeath removes it from the scene');
  });

  test('destroyOnDeath=false keeps the object', () => {
    const scene = new Scene('HealthScene');
    const go = new GameObject('Boss');
    scene.addGameObject(go);
    const health = go.addComponent(new HealthComponent({ maxHealth: 10, destroyOnDeath: false }));
    health.takeDamage(10);
    assert.strictEqual(health.isDead, true);
    assert.ok(scene.findByName('Boss'));
  });

  test('invulnerability window blocks damage until it expires', () => {
    const go = new GameObject('Player');
    const health = go.addComponent(new HealthComponent({ maxHealth: 100, invulnerabilitySeconds: 0.5 }));

    assert.strictEqual(health.takeDamage(10), 10);
    assert.strictEqual(health.isInvulnerable, true);
    assert.strictEqual(health.takeDamage(10), 0, 'blocked during the window');

    health.update(0.25);
    assert.strictEqual(health.takeDamage(10), 0);
    health.update(0.3);
    assert.strictEqual(health.isInvulnerable, false);
    assert.strictEqual(health.takeDamage(10), 10);
  });

  test('damage events carry amount, remaining health, and source', () => {
    const go = new GameObject('Enemy');
    const health = go.addComponent(new HealthComponent({ maxHealth: 100 }));
    const events: Array<{ amount: number; remaining: number; source: unknown }> = [];
    health.onDamage((event) => events.push({ amount: event.amount, remaining: event.remaining, source: event.source }));

    health.takeDamage(25, 'plasma');
    assert.deepStrictEqual(events, [{ amount: 25, remaining: 75, source: 'plasma' }]);
  });

  test('invalid damage amounts are ignored', () => {
    const go = new GameObject('Enemy');
    const health = go.addComponent(new HealthComponent({ maxHealth: 100 }));
    assert.strictEqual(health.takeDamage(0), 0);
    assert.strictEqual(health.takeDamage(-5), 0);
    assert.strictEqual(health.takeDamage(Number.NaN), 0);
    assert.strictEqual(health.health, 100);
  });

  test('heal clamps to max and does nothing when dead', () => {
    const go = new GameObject('Player');
    const health = go.addComponent(new HealthComponent({ maxHealth: 100 }));
    health.takeDamage(40);
    assert.strictEqual(health.heal(100), 40);
    assert.strictEqual(health.health, 100);
    assert.strictEqual(health.heal(10), 0);

    health.takeDamage(1000);
    assert.strictEqual(health.heal(50), 0, 'dead entities cannot be healed');
  });

  test('onDestroy clears listeners', () => {
    const go = new GameObject('Enemy');
    const health = go.addComponent(new HealthComponent({ maxHealth: 10 }));
    let deaths = 0;
    health.onDeath(() => deaths++);
    health.onDestroy();
    health.takeDamage(10);
    assert.strictEqual(deaths, 0, 'listeners were cleared, so no callback');
  });

  test('toJSON serializes the tuning fields', () => {
    const go = new GameObject('Enemy');
    const health = go.addComponent(
      new HealthComponent({ maxHealth: 80, health: 40, invulnerabilitySeconds: 0.2, destroyOnDeath: false })
    );
    const json = health.toJSON();
    assert.strictEqual(json.type, 'HealthComponent');
    assert.strictEqual(json.maxHealth, 80);
    assert.strictEqual(json.health, 40);
    assert.strictEqual(json.invulnerabilitySeconds, 0.2);
    assert.strictEqual(json.destroyOnDeath, false);
  });
});
