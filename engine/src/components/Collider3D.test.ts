import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Collider3D } from './Collider3D.js';
import { RigidBody3D } from './RigidBody3D.js';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';

async function colliderScene(shape: 'box' | 'sphere' | 'capsule' | 'cylinder') {
  const scene = new Scene('ColliderScene');
  const physics = new PhysicsWorld();
  await physics.initialize();
  scene.physicsWorld = physics;

  const go = new GameObject('Target');
  go.transform.setPosition(0, 3, 0);
  const rb = go.addComponent(new RigidBody3D({ bodyType: 'dynamic', mass: 10 }));
  const col = go.addComponent(new Collider3D({ shape, size: [1, 2, 1] }));
  scene.addGameObject(go);
  rb.initPhysics(physics);
  col.initPhysics(physics);
  return { scene, physics, go, rb, col };
}

describe('Collider3D — shape creation, materials, and lifecycle', () => {
  test('creates Rapier colliders for every supported shape', async () => {
    for (const shape of ['box', 'sphere', 'capsule', 'cylinder'] as const) {
      const { physics, col } = await colliderScene(shape);
      assert.ok(col.rapierCollider, `${shape} should create a collider`);
      physics.destroy();
    }
  });

  test('applies friction, restitution, and sensor flags', async () => {
    const scene = new Scene('MaterialScene');
    const physics = new PhysicsWorld();
    await physics.initialize();
    scene.physicsWorld = physics;

    const go = new GameObject('Sensor');
    const rb = go.addComponent(new RigidBody3D({ bodyType: 'dynamic' }));
    const col = go.addComponent(new Collider3D({ shape: 'box', size: [1, 1, 1], friction: 0.8, restitution: 0.4, isTrigger: true }));
    scene.addGameObject(go);
    rb.initPhysics(physics);
    col.initPhysics(physics);

    assert.ok(Math.abs(col.rapierCollider!.friction() - 0.8) < 1e-6);
    assert.ok(Math.abs(col.rapierCollider!.restitution() - 0.4) < 1e-6);
    assert.strictEqual(col.rapierCollider!.isSensor(), true);
    physics.destroy();
  });

  test('onDestroy removes the collider from the physics world', async () => {
    const { physics, col } = await colliderScene('box');
    const before = physics.world!.colliders.len();
    col.onDestroy();
    const after = physics.world!.colliders.len();
    assert.strictEqual(after, before - 1);
    physics.destroy();
  });

  test('serialization round-trips collider options', () => {
    const col = new Collider3D({ shape: 'sphere', size: [2, 2, 2], isTrigger: true, restitution: 0.2 });
    const json = col.toJSON();
    assert.strictEqual(json.type, 'Collider3D');
    assert.strictEqual(json.shape, 'sphere');
    assert.strictEqual(json.isTrigger, true);

    const other = new Collider3D();
    other.fromJSON(json);
    assert.strictEqual(other.shape, 'sphere');
    assert.strictEqual(other.restitution, 0.2);
  });
});
