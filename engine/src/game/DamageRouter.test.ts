import { test, describe } from 'node:test';
import assert from 'node:assert';
import { attachDamageRouter, type HitEventLike } from './DamageRouter.js';
import { HealthComponent } from '../components/HealthComponent.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { WeaponController } from '../weapons/WeaponController.js';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';

class FakeHitSource {
  private listeners = new Set<(event: HitEventLike) => void>();

  public onHit(listener: (event: HitEventLike) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public emit(event: HitEventLike): void {
    for (const listener of this.listeners) listener(event);
  }

  public get listenerCount(): number {
    return this.listeners.size;
  }
}

function arena() {
  const scene = new Scene('Arena');
  const enemy = new GameObject('Enemy');
  scene.addGameObject(enemy);
  const health = enemy.addComponent(new HealthComponent({ maxHealth: 50, destroyOnDeath: false }));
  return { scene, enemy, health, source: new FakeHitSource() };
}

describe('DamageRouter — hit events to health', () => {
  test('routes damage to the hit entity', () => {
    const { scene, health, source } = arena();
    const damage: Array<[string, number]> = [];
    attachDamageRouter(scene, source, { onDamage: (name, applied) => damage.push([name, applied]) });

    source.emit({ hitObjectName: 'Enemy', damage: 20 });
    assert.strictEqual(health.health, 30);
    assert.deepStrictEqual(damage, [['Enemy', 20]]);
  });

  test('reports kills when the hit is lethal', () => {
    const { scene, health, source } = arena();
    const kills: string[] = [];
    attachDamageRouter(scene, source, { onKill: (name) => kills.push(name) });

    source.emit({ hitObjectName: 'Enemy', damage: 20 });
    assert.deepStrictEqual(kills, []);
    source.emit({ hitObjectName: 'Enemy', damage: 100 });
    assert.strictEqual(health.health, 0);
    assert.deepStrictEqual(kills, ['Enemy']);
  });

  test('ignores hits on unknown objects and objects without health', () => {
    const { scene, source } = arena();
    const noHealth = new GameObject('Crate');
    scene.addGameObject(noHealth);
    const damage: string[] = [];
    attachDamageRouter(scene, source, { onDamage: (name) => damage.push(name) });

    source.emit({ hitObjectName: 'Ghost', damage: 10 });
    source.emit({ hitObjectName: 'Crate', damage: 10 });
    assert.deepStrictEqual(damage, []);
  });

  test('detaching stops routing and unsubscribes the source', () => {
    const { scene, health, source } = arena();
    const detach = attachDamageRouter(scene, source);
    assert.strictEqual(source.listenerCount, 1);

    source.emit({ hitObjectName: 'Enemy', damage: 10 });
    assert.strictEqual(health.health, 40);

    detach();
    assert.strictEqual(source.listenerCount, 0);
    source.emit({ hitObjectName: 'Enemy', damage: 10 });
    assert.strictEqual(health.health, 40, 'no damage after detach');
  });

  test('zero applied damage (invulnerable) does not report', () => {
    const scene = new Scene('Arena');
    const enemy = new GameObject('Enemy');
    scene.addGameObject(enemy);
    const health = enemy.addComponent(new HealthComponent({ maxHealth: 50, invulnerabilitySeconds: 1 }));
    const source = new FakeHitSource();
    const damage: string[] = [];
    attachDamageRouter(scene, source, { onDamage: (name) => damage.push(name) });

    source.emit({ hitObjectName: 'Enemy', damage: 10 });
    source.emit({ hitObjectName: 'Enemy', damage: 10 });
    assert.strictEqual(health.health, 40);
    assert.strictEqual(damage.length, 1, 'blocked hit is not reported');
  });
});

describe('DamageRouter — end-to-end with a real weapon raycast', () => {
  test('a weapon shot damages the hit entity and reports the kill', () => {
    const scene = new Scene('CombatScene');

    const shooter = new GameObject('Shooter');
    shooter.transform.setPosition(0, 0, 0);
    const weapon = shooter.addComponent(new WeaponController({ maxAmmo: 10, fireRate: 100 }));
    scene.addGameObject(shooter);

    const enemy = new GameObject('Enemy');
    enemy.transform.setPosition(0, 0, -5);
    enemy.addComponent(new MeshRenderer({ shape: 'box', size: [2, 2, 1] }));
    const health = enemy.addComponent(new HealthComponent({ maxHealth: 50, destroyOnDeath: false }));
    scene.addGameObject(enemy);

    // Sync three.js mesh transforms before raycasting (weapon hits are raycasts).
    scene.update(0.016);

    const kills: string[] = [];
    const damage: Array<[string, number]> = [];
    attachDamageRouter(scene, weapon, {
      onKill: (name) => kills.push(name),
      onDamage: (name, applied) => damage.push([name, applied])
    });

    const shot = weapon.fire();
    assert.strictEqual(shot.hit, true, 'shot should hit the enemy');
    assert.strictEqual(shot.hitObjectName, 'Enemy', 'hit must resolve to the engine entity name');
    assert.strictEqual(health.health, 50 - weapon.damage);
    assert.deepStrictEqual(damage, [['Enemy', weapon.damage]]);

    weapon.update(1);
    weapon.fire();
    assert.strictEqual(health.health, 0);
    assert.deepStrictEqual(kills, ['Enemy'], 'lethal hit reports the kill through the router');
  });
});
