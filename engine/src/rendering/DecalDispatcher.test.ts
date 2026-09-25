import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { WeaponController } from '../weapons/WeaponController.js';
import { DecalDispatcher } from './DecalDispatcher.js';

describe('DecalDispatcher — impact decal registry', () => {
  test('records decals with position, normal, size and color', () => {
    const dispatcher = new DecalDispatcher();
    const decal = dispatcher.addDecal(
      { point: [1, 2, 3], normal: [0, 1, 0] },
      { size: 0.8, ttl: 10, color: '#333333' }
    );

    assert.strictEqual(dispatcher.count, 1);
    assert.deepStrictEqual(decal.position, [1, 2, 3]);
    assert.deepStrictEqual(decal.normal, [0, 1, 0]);
    assert.strictEqual(decal.size, 0.8);
    assert.strictEqual(decal.color, '#333333');
  });

  test('caps the registry and evicts the oldest decal', () => {
    const dispatcher = new DecalDispatcher();
    dispatcher.maxDecals = 5;
    for (let i = 0; i < 8; i++) {
      dispatcher.addDecal({ point: [i, 0, 0], normal: [0, 1, 0] });
    }
    assert.strictEqual(dispatcher.count, 5);
    const first = dispatcher.getDecals()[0];
    assert.strictEqual(first.position[0], 3, 'oldest three decals should be evicted');
  });

  test('expires decals after ttl and fades near the end of life', () => {
    const dispatcher = new DecalDispatcher();
    dispatcher.addDecal({ point: [0, 0, 0], normal: [0, 1, 0] }, { ttl: 4 });

    dispatcher.update(2.9); // within full-opacity window
    assert.strictEqual(dispatcher.count, 1);
    assert.strictEqual(dispatcher.getDecals()[0].opacity, 1);

    dispatcher.update(0.5); // age 3.4 → inside final 25% (ttl*0.25 = 1)
    assert.ok(dispatcher.getDecals()[0].opacity < 1, 'opacity should fade near expiry');

    dispatcher.update(1.0); // age 4.4 → expired
    assert.strictEqual(dispatcher.count, 0);
  });

  test('integrates with WeaponController hit events end-to-end', () => {
    const scene = new Scene('DecalTestScene');

    // Weapon looking down -Z from the origin
    const weaponGo = new GameObject('Weapon');
    weaponGo.transform.setPosition(0, 0, 0);
    const weapon = new WeaponController({ maxAmmo: 10, fireRate: 100 });
    weaponGo.addComponent(weapon);
    scene.addGameObject(weaponGo);

    // Target box 5m down-range
    const target = new GameObject('TargetWall');
    target.transform.setPosition(0, 0, -5);
    target.addComponent(new MeshRenderer({ shape: 'box', size: [4, 4, 0.5] }));
    scene.addGameObject(target);

    const dispatcher = new DecalDispatcher();
    weaponGo.addComponent(dispatcher);

    // Sync three.js mesh transforms from ECS transforms before raycasting
    scene.update(0.016);

    const received: Array<{ point: number[]; normal: number[] | null }> = [];
    const unsubscribe = weapon.onHit(hit => {
      received.push({ point: hit.point, normal: hit.normal });
      dispatcher.addDecal({ point: hit.point, normal: hit.normal });
    });

    const result = weapon.fire();
    assert.strictEqual(result.hit, true, 'shot should hit the target wall');
    assert.strictEqual(result.hitObjectName, 'TargetWall', 'hit name must be the engine entity name');
    assert.ok(result.point && result.point[2] < -4, `impact should be near the wall, z=${result.point?.[2]}`);
    assert.strictEqual(received.length, 1, 'hit listener should fire once');
    assert.strictEqual(dispatcher.count, 1, 'dispatcher should register the impact decal');

    unsubscribe();
    weapon.update(1); // clears the fire cooldown
    weapon.fire();
    assert.strictEqual(received.length, 1, 'unsubscribed listeners should not receive events');
  });
});
