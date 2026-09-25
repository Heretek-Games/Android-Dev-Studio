import { test, describe } from 'node:test';
import assert from 'node:assert';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { RigidBody3D } from '../components/RigidBody3D.js';
import { Collider3D } from '../components/Collider3D.js';

async function buildPhysicsScene() {
  const scene = new Scene('PhysicsTest');
  const physics = new PhysicsWorld();
  await physics.initialize();
  scene.physicsWorld = physics;

  const ground = new GameObject('Ground');
  ground.transform.setPosition(0, -0.5, 0);
  ground.addComponent(new RigidBody3D({ bodyType: 'fixed' }));
  ground.addComponent(new Collider3D({ shape: 'box', size: [100, 1, 100] }));
  scene.addGameObject(ground);

  const ball = new GameObject('Ball');
  ball.transform.setPosition(0, 5, 0);
  ball.addComponent(new RigidBody3D({ bodyType: 'dynamic', mass: 2 }));
  ball.addComponent(new Collider3D({ shape: 'sphere', size: [1, 1, 1] }));
  scene.addGameObject(ball);

  for (const go of scene.gameObjects) {
    const rb = go.getComponent(RigidBody3D);
    const col = go.getComponent(Collider3D);
    if (rb) rb.initPhysics(physics);
    if (col) col.initPhysics(physics);
  }
  return { scene, physics, ground, ball };
}

describe('PhysicsWorld — Rapier integration, stepping, and raycasts', () => {
  test('initialize creates a ready world and gravity pulls dynamic bodies down', async () => {
    const { physics, scene, ball } = await buildPhysicsScene();
    assert.strictEqual(physics.isReady, true);

    const startY = ball.transform.position.y;
    for (let i = 0; i < 30; i++) scene.update(1 / 60);
    assert.ok(ball.transform.position.y < startY, 'gravity should pull the ball down');
    physics.destroy();
  });

  test('fixed bodies stay put and dynamic bodies rest on them', async () => {
    const { physics, scene, ground, ball } = await buildPhysicsScene();
    for (let i = 0; i < 240; i++) scene.update(1 / 60);

    assert.strictEqual(ground.transform.position.y, -0.5, 'fixed ground never moves');
    assert.ok(ball.transform.position.y > 0, 'ball should rest on the ground, not sink through');
    assert.ok(ball.transform.position.y < 1.5, 'ball should settle near the surface');
    physics.destroy();
  });

  test('castRay reports hits and misses with toi distances', async () => {
    const { physics, scene } = await buildPhysicsScene();
    scene.update(1 / 60); // Rapier's query pipeline populates on the first step

    const down = physics.castRay({ x: 3, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 20);
    assert.strictEqual(down.hit, true);
    assert.ok(Math.abs(down.toi - 5.0) < 0.05, `expected hit at ~5.0m, got ${down.toi}`);

    const up = physics.castRay({ x: 3, y: 5, z: 0 }, { x: 0, y: 1, z: 0 }, 20);
    assert.strictEqual(up.hit, false, 'nothing above the ball');

    physics.destroy();
  });

  test('castRayAndGetNormal returns the contact normal', async () => {
    const { physics, scene } = await buildPhysicsScene();
    scene.update(1 / 60); // Rapier's query pipeline populates on the first step

    const result = physics.castRayAndGetNormal({ x: 3, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 20);
    assert.strictEqual(result.hit, true);
    assert.ok(result.normal.y > 0.99, `flat ground normal should point up, got ${JSON.stringify(result.normal)}`);

    const miss = physics.castRayAndGetNormal({ x: 50, y: 50, z: 50 }, { x: 0, y: 1, z: 0 }, 5);
    assert.strictEqual(miss.hit, false);
    assert.deepStrictEqual(miss.normal, { x: 0, y: 1, z: 0 }, 'misses return a safe default normal');

    physics.destroy();
  });

  test('setGravity updates world gravity', async () => {
    const { physics, scene, ball } = await buildPhysicsScene();
    physics.setGravity(0, -30, 0);

    const startY = ball.transform.position.y;
    for (let i = 0; i < 30; i++) scene.update(1 / 60);
    const drop = startY - ball.transform.position.y;

    // With g=-30 the fall over 0.5s is ~3.75m; with default -9.81 it would be ~1.2m
    assert.ok(drop > 2.5, `stronger gravity should drop faster, got ${drop.toFixed(2)}m`);
    physics.destroy();
  });
});
