import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { Transform } from './Transform.js';

describe('Transform — position/rotation/scale and hierarchy', () => {
  test('sets position, rotation, and scale', () => {
    const t = new Transform();
    t.setPosition(1, 2, 3);
    t.setRotation(0.1, 0.2, 0.3);
    t.setScale(2, 2, 2);

    assert.deepStrictEqual([t.position.x, t.position.y, t.position.z], [1, 2, 3]);
    assert.ok(Math.abs(t.rotation.y - 0.2) < 1e-9);
    assert.strictEqual(t.scale.x, 2);
  });

  test('translate and rotateY accumulate deltas', () => {
    const t = new Transform();
    t.translate(1, 0, -1);
    t.translate(0.5, 0, 0.5);
    t.rotateY(Math.PI / 2);

    assert.strictEqual(t.position.x, 1.5);
    assert.strictEqual(t.position.z, -0.5);
    assert.ok(Math.abs(t.rotation.y - Math.PI / 2) < 1e-9);
    // Quaternion stays in sync with the euler rotation
    assert.ok(Math.abs(t.quaternion.y - Math.sin(Math.PI / 4)) < 1e-6);
  });

  test('child world position reflects parent transform', () => {
    const parent = new Transform();
    parent.setPosition(10, 0, 0);
    const child = new Transform();
    child.setPosition(2, 1, 0);
    parent.addChild(child);

    const world = child.getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(world.x - 12) < 1e-6, `expected x=12, got ${world.x}`);
    assert.ok(Math.abs(world.y - 1) < 1e-6);
  });

  test('removeChild detaches and serialization round-trips', () => {
    const parent = new Transform();
    const child = new Transform();
    parent.addChild(child);
    assert.strictEqual(child.parent, parent);
    parent.removeChild(child);
    assert.strictEqual(child.parent, null);

    const t = new Transform();
    t.setPosition(4, 5, 6);
    t.setRotation(0.5, 0, 0);
    const json = t.toJSON();
    assert.deepStrictEqual(json.position, [4, 5, 6]);
    assert.ok(Math.abs(json.rotation[0] - 0.5) < 1e-9);
  });
});
