import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { RigidBody3D } from '../components/RigidBody3D.js';
import { Collider3D } from '../components/Collider3D.js';
import { ParticleSystem } from '../particles/ParticleSystem.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import {
  Destructible,
  DestructionPool,
  setDestructionPool,
  shardPattern
} from './Destructible.js';

function crate(
  scene: Scene,
  physics: PhysicsWorld | null,
  options?: Record<string, unknown>
): { go: GameObject; destructible: Destructible } {
  const go = new GameObject('Crate');
  go.transform.setPosition(0, 1, 0);
  go.addComponent(new MeshRenderer({ shape: 'box', size: [2, 2, 2], color: '#a16207' }));
  go.addComponent(new RigidBody3D({ bodyType: 'dynamic', mass: 2 }));
  go.addComponent(new Collider3D({ shape: 'box', size: [2, 2, 2] }));
  const destructible = go.addComponent(new Destructible(options as never));
  scene.addGameObject(go);
  if (physics) {
    for (const comp of go.components) {
      if (comp instanceof RigidBody3D || comp instanceof Collider3D) {
        (comp as RigidBody3D | Collider3D).initPhysics(physics);
      }
    }
  }
  return { go, destructible };
}

describe('Destructible — fracture, pool, dust (Chaos-lite)', () => {
  test('shardPattern subdivides deterministically with stable volume', () => {
    const a = shardPattern([2, 2, 2], [2, 2, 2], 0.15, 7);
    const b = shardPattern([2, 2, 2], [2, 2, 2], 0.15, 7);
    assert.strictEqual(a.length, 8);
    assert.deepStrictEqual(a, b);
    const volume = a.reduce((sum, s) => sum + s.size[0] * s.size[1] * s.size[2], 0);
    assert.ok(Math.abs(volume - 8) < 1e-6, `volume=${volume}`);
    const c = shardPattern([2, 2, 2], [2, 2, 2], 0.15, 8);
    assert.notDeepStrictEqual(a, c);
    const flat = shardPattern([1, 1, 1], [1, 1, 1], 0, 1);
    assert.strictEqual(flat.length, 1);
  });

  test('manual fracture spawns shards, parks owner, puffs dust', () => {
    const pool = new DestructionPool();
    setDestructionPool(pool);
    try {
      const scene = new Scene('Test');
      const { go, destructible } = crate(scene, null, { dustBurst: 10 });
      const shards = destructible.fracture(120);
      assert.strictEqual(shards.length, 8);
      assert.strictEqual(destructible.fractured, true);
      assert.strictEqual(destructible.fractureCount, 1);
      assert.strictEqual(go.active, false);
      assert.deepStrictEqual(destructible.fracture(200), [], 'idempotent');
      assert.strictEqual(pool.liveShards, 8);
      const dust = scene.findByName('Crate_dust');
      assert.ok(dust, 'dust emitter created');
      const emitter = dust!.getComponent(ParticleSystem)!;
      assert.ok(emitter.aliveCount > 0, `dust alive=${emitter.aliveCount}`);
    } finally {
      setDestructionPool(null);
    }
  });

  test('falling ball fractures the crate on impact', async () => {
    const pool = new DestructionPool();
    setDestructionPool(pool);
    try {
      const physics = new PhysicsWorld();
      await physics.initialize();
      physics.enableContactForces();
      pool.attachWorld(physics);
      pool.maxLiveShards = 32;
      const scene = new Scene('Test');
      scene.physicsWorld = physics;
      const ground = new GameObject('Ground');
      ground.transform.setPosition(0, -0.5, 0);
      ground.addComponent(new MeshRenderer({ shape: 'box', size: [30, 1, 30], color: '#18181b' }));
      ground.addComponent(new RigidBody3D({ bodyType: 'fixed' }));
      ground.addComponent(new Collider3D({ shape: 'box', size: [30, 1, 30] }));
      scene.addGameObject(ground);
      const { destructible } = crate(scene, physics, { impulseThreshold: 5, dustBurst: 8 });
      const ball = new GameObject('Wrecker');
      ball.transform.setPosition(0, 8, 0);
      ball.addComponent(new MeshRenderer({ shape: 'sphere', size: [1, 1, 1], color: '#ef4444' }));
      ball.addComponent(new RigidBody3D({ bodyType: 'dynamic', mass: 12 }));
      ball.addComponent(new Collider3D({ shape: 'sphere', size: [1, 1, 1] }));
      scene.addGameObject(ball);
      for (const go of scene.gameObjects) {
        for (const comp of go.components) {
          if (comp instanceof RigidBody3D || comp instanceof Collider3D) {
            (comp as RigidBody3D | Collider3D).initPhysics(physics);
          }
        }
      }
      let frames = 0;
      while (!destructible.fractured && frames < 600) {
        scene.update(1 / 60);
        pool.update(1 / 60);
        frames++;
      }
      assert.strictEqual(destructible.fractured, true, `fractured after ${frames} frames`);
      assert.strictEqual(pool.liveShards, 8);
      assert.strictEqual(destructible.fractureCount, 1);
    } finally {
      setDestructionPool(null);
    }
  });

  test('shards sleep then merge; live cap evicts oldest first', async () => {
    const pool = new DestructionPool();
    pool.maxLiveShards = 4;
    setDestructionPool(pool);
    try {
      const physics = new PhysicsWorld();
      await physics.initialize();
      pool.attachWorld(physics);
      const scene = new Scene('Test');
      scene.physicsWorld = physics;
      const { destructible } = crate(scene, physics, { sleepDelay: 0.2, dustBurst: 0 });
      destructible.fracture(100);
      assert.strictEqual(pool.liveShards, 8);
      // Cap enforcement merges oldest dynamic shards immediately.
      pool.update(1 / 60);
      assert.ok(pool.liveShards <= 4, `capped: ${pool.liveShards}`);
      assert.ok(pool.mergedShards >= 4, `merged: ${pool.mergedShards}`);
    } finally {
      setDestructionPool(null);
    }
    // Sleep path without physics (bodies report sleeping by default):
    // timers decrement and every shard merges.
    const quiet = new DestructionPool();
    setDestructionPool(quiet);
    try {
      const scene = new Scene('Quiet');
      const { destructible } = crate(scene, null, { sleepDelay: 0.2, dustBurst: 0 });
      destructible.fracture(100);
      assert.strictEqual(quiet.liveShards, 8);
      for (let i = 0; i < 60; i++) quiet.update(1 / 60);
      assert.strictEqual(quiet.liveShards, 0);
      assert.strictEqual(quiet.mergedShards, 8);
    } finally {
      setDestructionPool(null);
    }
  });

  test('serializes tuning and fracture state', () => {
    const scene = new Scene('Test');
    const { destructible } = crate(scene, null, { impulseThreshold: 42 });
    destructible.fracture(90);
    const json = destructible.toJSON();
    assert.strictEqual(json.type, 'Destructible');
    assert.strictEqual(json.fractured, true);
    const other = new Destructible();
    other.fromJSON(JSON.parse(JSON.stringify(json)));
    assert.strictEqual(other.impulseThreshold, 42);
    assert.strictEqual(other.fractured, true);
    assert.strictEqual(other.fractureCount, 1);
    setDestructionPool(null);
  });
});
