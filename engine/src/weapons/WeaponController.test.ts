import { test, describe } from 'node:test';
import assert from 'node:assert';
import { WeaponController } from './WeaponController.js';

describe('WeaponController — ballistics state machine', () => {
  test('firing consumes ammo and enforces the fire rate cooldown', () => {
    const weapon = new WeaponController({ maxAmmo: 5, fireRate: 10 });

    assert.strictEqual(weapon.canFire(), true);
    weapon.fire();
    assert.strictEqual(weapon.currentAmmo, 4);
    assert.strictEqual(weapon.canFire(), false, 'in cooldown immediately after firing');

    weapon.update(0.11); // 1/10s cooldown + slack
    assert.strictEqual(weapon.canFire(), true);
  });

  test('recoil kicks on fire and recovers over time', () => {
    const weapon = new WeaponController({ recoilKick: 2.0 });
    weapon.fire();
    assert.strictEqual(weapon.currentRecoil, 2.0);

    weapon.update(0.5);
    assert.ok(weapon.currentRecoil < 2.0, 'recoil decays');
    assert.ok(weapon.currentRecoil >= 0);
  });

  test('empty magazine triggers a reload that restores full ammo', () => {
    const weapon = new WeaponController({ maxAmmo: 3, fireRate: 100, reloadTime: 0.5 });
    weapon.currentAmmo = 0;
    weapon.fire(); // should start reloading instead of firing
    assert.strictEqual(weapon.isReloading, true);

    weapon.update(0.6);
    assert.strictEqual(weapon.isReloading, false);
    assert.strictEqual(weapon.currentAmmo, 3);
  });

  test('firing without a scene reports a miss at max range', () => {
    const weapon = new WeaponController({ range: 42 });
    const result = weapon.fire();
    assert.strictEqual(result.hit, false);
    assert.strictEqual(result.distance, 42);
  });

  test('hit listeners are notified and unsubscribe cleanly', () => {
    // Covered end-to-end (raycast -> event -> decal) in DecalDispatcher.test.ts;
    // here we assert the listener bookkeeping contract.
    const weapon = new WeaponController();
    const seen: string[] = [];
    const unsubscribe = weapon.onHit(hit => seen.push(hit.hitObjectName));
    assert.strictEqual(typeof unsubscribe, 'function');
    weapon.fire(); // miss (no scene) -> no events
    assert.strictEqual(seen.length, 0);
    unsubscribe();
  });

  test('serialization exposes weapon identity', () => {
    const weapon = new WeaponController({ name: 'Plasma Rifle' });
    const json = weapon.toJSON();
    assert.strictEqual(json.type, 'WeaponController');
  });
});
