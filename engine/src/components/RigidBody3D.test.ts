import { test, describe } from 'node:test';
import assert from 'node:assert';
import { RigidBody3D } from './RigidBody3D.js';
import { Collider3D } from './Collider3D.js';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';

async function physicsPair() {
  const scene = new Scene('RBTest');
  const physics = new PhysicsWorld();
  await physics.initialize();
  scene.physicsWorld = physics;

  const go = new GameObject('Body');
  go.transform.setPosition(0, 5, 0);
  const rb = go.addComponent(new RigidBody3D({ bodyType: 'dynamic', mass: 50 }));
  const col = go.addComponent(new Collider3D({ shape: 'box', size: [2, 2, 2] }));
  scene.addGameObject(go);
  rb.initPhysics(physics);
  col.initPhysics(physics);
  return { scene, physics, go, rb, col };
}

describe('RigidBody3D & Collider3D — bodies, mass, and forces', () => {
  test('configured mass is distributed across colliders and honored by Rapier', async () => {
    const { scene, physics, rb } = await physicsPair();
    scene.update(1 / 60); // Rapier recomputes mass properties on step
    const mass = rb.rapierBody?.mass() ?? 0;
    assert.ok(Math.abs(mass - 50) < 0.5, `expected ~50kg, got ${mass}`);
    physics.destroy();
  });

  test('setLinearVelocity and applyImpulse change body velocity', async () => {
    const { physics, rb } = await physicsPair();
    rb.setLinearVelocity(3, 0, -2);
    let vel = rb.rapierBody!.linvel();
    assert.ok(Math.abs(vel.x - 3) < 1e-6 && Math.abs(vel.z + 2) < 1e-6);

    rb.setLinearVelocity(0, 0, 0);
    rb.applyImpulse(0, 100, 0); // 100 N·s on 50kg → +2 m/s
    vel = rb.rapierBody!.linvel();
    assert.ok(Math.abs(vel.y - 2) < 0.05, `expected +2 m/s, got ${vel.y}`);
    physics.destroy();
  });

  test('fixed bodies ignore velocity and force APIs', async () => {
    const scene = new Scene('FixedTest');
    const physics = new PhysicsWorld();
    await physics.initialize();
    scene.physicsWorld = physics;

    const go = new GameObject('Wall');
    const rb = go.addComponent(new RigidBody3D({ bodyType: 'fixed' }));
    go.addComponent(new Collider3D({ shape: 'box', size: [1, 1, 1] }));
    scene.addGameObject(go);
    rb.initPhysics(physics);
    go.getComponent(Collider3D)!.initPhysics(physics);

    rb.setLinearVelocity(10, 0, 0);
    rb.applyForce(1000, 0, 0);
    const vel = rb.rapierBody!.linvel();
    assert.strictEqual(vel.x, 0, 'fixed bodies never move');
    physics.destroy();
  });

  test('serialization round-trips body and collider options', () => {
    const rb = new RigidBody3D({ bodyType: 'dynamic', mass: 12, linearDamping: 0.2 });
    const json = rb.toJSON();
    assert.strictEqual(json.type, 'RigidBody3D');
    assert.strictEqual(json.mass, 12);
    assert.strictEqual(json.bodyType, 'dynamic');

    const rb2 = new RigidBody3D();
    rb2.fromJSON(json);
    assert.strictEqual(rb2.mass, 12);
    assert.strictEqual(rb2.linearDamping, 0.2);

    const col = new Collider3D({ shape: 'capsule', size: [1, 2, 1], friction: 0.9 });
    const cjson = col.toJSON();
    assert.strictEqual(cjson.type, 'Collider3D');
    assert.strictEqual(cjson.shape, 'capsule');
    assert.deepStrictEqual(cjson.size, [1, 2, 1]);
    assert.strictEqual(cjson.friction, 0.9);
  });

  test('collider setMass override after init wins immediately (no step needed)', async () => {
    const scene = new Scene('MassOverride');
    const physics = new PhysicsWorld();
    await physics.initialize();
    scene.physicsWorld = physics;

    const go = new GameObject('Heavy');
    const rb = go.addComponent(new RigidBody3D({ bodyType: 'dynamic', mass: 100 }));
    const col = go.addComponent(new Collider3D({ shape: 'box', size: [1, 1, 1] }));
    // Pre-init override is superseded by the body's mass distribution (by design)
    col.setMass(25);
    assert.strictEqual(col.massOverride, 25);

    scene.addGameObject(go);
    rb.initPhysics(physics);
    col.initPhysics(physics);

    const bodyMass = rb.rapierBody?.mass() ?? 0;
    assert.ok(Math.abs(bodyMass - 100) < 0.5, `body mass distribution supersedes the pre-init override, got ${bodyMass}`);

    // Post-init override recomputes mass properties immediately
    col.setMass(25);
    const overridden = rb.rapierBody?.mass() ?? 0;
    assert.ok(Math.abs(overridden - 25) < 0.5, `post-init override should apply immediately, got ${overridden}`);
    physics.destroy();
  });
});
