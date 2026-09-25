import { test, describe } from 'node:test';
import assert from 'node:assert';
import { WaveSpawner } from './WaveSpawner.js';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';

function makeSpawner(options: { totalWaves?: number; perWave?: number; failFactory?: boolean; radius?: number } = {}) {
  const scene = new Scene('WaveArena');
  const spawner = new WaveSpawner(scene, {
    totalWaves: options.totalWaves ?? 2,
    enemiesPerWave: () => options.perWave ?? 2,
    spawnRadius: options.radius ?? 10,
    interWaveDelaySeconds: 1,
    buildEnemy: ({ name, position }) => {
      if (options.failFactory) return null;
      const enemy = new GameObject(name);
      enemy.transform.setPosition(position[0], position[1], position[2]);
      scene.addGameObject(enemy);
      return enemy;
    }
  });
  return { scene, spawner };
}

describe('WaveSpawner — waves, clearing, completion', () => {
  test('start spawns the first wave on a ring with unique names', () => {
    const { scene, spawner } = makeSpawner({ perWave: 3, radius: 10 });
    spawner.start();

    assert.strictEqual(spawner.getWave(), 1);
    assert.strictEqual(spawner.getAliveCount(), 3);
    const names = spawner.getSpawnedNames();
    assert.deepStrictEqual(names, ['Enemy W1-0', 'Enemy W1-1', 'Enemy W1-2']);
    for (const name of names) {
      const enemy = scene.findByName(name)!;
      const distance = Math.hypot(enemy.transform.position.x, enemy.transform.position.z);
      assert.ok(Math.abs(distance - 10) < 1e-6, `${name} should sit on the spawn ring`);
    }
  });

  test('does not advance while enemies are alive', () => {
    const { spawner } = makeSpawner();
    spawner.start();
    spawner.update(5);
    assert.strictEqual(spawner.getWave(), 1);
    assert.strictEqual(spawner.isComplete(), false);
  });

  test('clearing a wave waits out the delay, then spawns the next', () => {
    const { scene, spawner } = makeSpawner({ totalWaves: 2, perWave: 2 });
    const cleared: number[] = [];
    spawner.onWaveCleared((wave) => cleared.push(wave));
    spawner.start();

    for (const name of spawner.getSpawnedNames()) scene.findByName(name)!.destroy();
    spawner.update(0.1);
    assert.deepStrictEqual(cleared, [1]);
    assert.strictEqual(spawner.getWave(), 2, 'wave counter advanced');
    assert.strictEqual(spawner.getAliveCount(), 0, 'next wave not spawned yet');

    spawner.update(1.1);
    assert.strictEqual(spawner.getAliveCount(), 2, 'second wave spawned after the delay');
  });

  test('clearing the final wave completes the spawner', () => {
    const { scene, spawner } = makeSpawner({ totalWaves: 1, perWave: 2 });
    let allCleared = 0;
    spawner.onAllWavesCleared(() => allCleared++);
    spawner.start();

    for (const name of spawner.getSpawnedNames()) scene.findByName(name)!.destroy();
    spawner.update(0.1);
    assert.strictEqual(allCleared, 1);
    assert.strictEqual(spawner.isComplete(), true);

    // Further updates are inert.
    spawner.update(10);
    assert.strictEqual(allCleared, 1);
  });

  test('a failing enemy factory cannot deadlock the spawner', () => {
    const { spawner } = makeSpawner({ totalWaves: 2, failFactory: true });
    spawner.start();
    spawner.update(0.1);
    assert.strictEqual(spawner.getWave(), 2, 'empty wave treated as cleared');

    spawner.update(1.1); // inter-wave delay elapsed -> wave 2 spawns (also empty)
    spawner.update(0.1);
    assert.strictEqual(spawner.isComplete(), true, 'all waves resolved');
  });

  test('stop() halts progression', () => {
    const { scene, spawner } = makeSpawner();
    spawner.start();
    for (const name of spawner.getSpawnedNames()) scene.findByName(name)!.destroy();
    spawner.stop();
    spawner.update(5);
    assert.strictEqual(spawner.getWave(), 1);
    assert.strictEqual(spawner.isComplete(), false);
  });

  test('start() is idempotent', () => {
    const { spawner } = makeSpawner();
    spawner.start();
    const names = spawner.getSpawnedNames();
    spawner.start();
    assert.deepStrictEqual(spawner.getSpawnedNames(), names);
  });
});
