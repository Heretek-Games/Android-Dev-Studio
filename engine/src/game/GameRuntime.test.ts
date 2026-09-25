import { test, describe } from 'node:test';
import assert from 'node:assert';
import { GameRuntime } from './GameRuntime.js';
import { HealthComponent } from '../components/HealthComponent.js';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';
import type { HitEventLike } from './DamageRouter.js';

class FakeWeapon {
  private listeners = new Set<(event: HitEventLike) => void>();
  public onHit(listener: (event: HitEventLike) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  public fireAt(name: string, damage: number): void {
    for (const listener of this.listeners) listener({ hitObjectName: name, damage });
  }
}

function makeRuntime(options: { totalWaves?: number; perWave?: number; playerHealth?: boolean } = {}) {
  const scene = new Scene('Arena');
  const player = new GameObject('Player Hero');
  scene.addGameObject(player);
  if (options.playerHealth !== false) {
    player.addComponent(new HealthComponent({ maxHealth: 100, destroyOnDeath: false }));
  }

  const weapon = new FakeWeapon();
  const runtime = new GameRuntime({
    scene,
    playerName: 'Player Hero',
    totalWaves: options.totalWaves ?? 2,
    enemiesPerWave: () => options.perWave ?? 2,
    spawnRadius: 8,
    scorePerKill: 100,
    interWaveDelaySeconds: 1,
    weapon,
    buildEnemy: ({ name, position }) => {
      const enemy = new GameObject(name);
      enemy.transform.setPosition(position[0], position[1], position[2]);
      scene.addGameObject(enemy);
      enemy.addComponent(new HealthComponent({ maxHealth: 50, destroyOnDeath: false }));
      return enemy;
    }
  });
  return { scene, player, weapon, runtime };
}

function killEnemy(scene: Scene, weapon: FakeWeapon, name: string) {
  weapon.fireAt(name, 50);
  scene.findByName(name)?.destroy();
}

describe('GameRuntime — full run wiring', () => {
  test('start begins the flow and spawns wave 1', () => {
    const { runtime } = makeRuntime();
    runtime.start();
    assert.strictEqual(runtime.flow.getPhase(), 'playing');
    assert.strictEqual(runtime.spawner.getWave(), 1);
    assert.strictEqual(runtime.spawner.getAliveCount(), 2);
    assert.strictEqual(runtime.isRunning(), true);
  });

  test('kills route through the weapon into score', () => {
    const { scene, weapon, runtime } = makeRuntime();
    runtime.start();
    const [first] = runtime.spawner.getSpawnedNames();

    weapon.fireAt(first, 50);
    assert.strictEqual(runtime.session.getScore(), 100, 'lethal hit registers a kill');
    assert.strictEqual(runtime.session.getKills(), 1);
  });

  test('clearing all waves wins the run', () => {
    const { scene, weapon, runtime } = makeRuntime({ totalWaves: 2, perWave: 1 });
    runtime.start();

    killEnemy(scene, weapon, runtime.spawner.getSpawnedNames()[0]);
    runtime.update(0.1); // wave 1 cleared -> delay
    runtime.update(1.1); // wave 2 spawns
    assert.strictEqual(runtime.spawner.getWave(), 2);

    killEnemy(scene, weapon, runtime.spawner.getSpawnedNames()[0]);
    runtime.update(0.1);
    assert.strictEqual(runtime.flow.getPhase(), 'won');
  });

  test('player death loses the run', () => {
    const { player, runtime } = makeRuntime();
    runtime.start();
    const health = player.getComponent(HealthComponent)!;
    health.takeDamage(100);
    assert.strictEqual(runtime.flow.getPhase(), 'lost');
  });

  test('restart resets counters and respawns wave 1', () => {
    const { scene, weapon, runtime } = makeRuntime({ totalWaves: 1, perWave: 1 });
    runtime.start();
    killEnemy(scene, weapon, runtime.spawner.getSpawnedNames()[0]);
    runtime.update(0.1);
    assert.strictEqual(runtime.flow.getPhase(), 'won');
    assert.strictEqual(runtime.session.getScore(), 100);

    runtime.restart();
    assert.strictEqual(runtime.flow.getPhase(), 'playing');
    assert.strictEqual(runtime.session.getScore(), 0);
    assert.strictEqual(runtime.spawner.getWave(), 1);
    assert.strictEqual(runtime.spawner.getAliveCount(), 1);
  });

  test('update pauses spawning while paused', () => {
    const { runtime } = makeRuntime({ totalWaves: 2, perWave: 1 });
    runtime.start();
    const before = runtime.spawner.getWave();
    runtime.flow.transition('pause');
    runtime.update(5);
    assert.strictEqual(runtime.spawner.getWave(), before, 'paused: no wave progression');
  });

  test('prepare wires without starting; start works afterwards', () => {
    const { scene, weapon, runtime } = makeRuntime({ totalWaves: 1, perWave: 1 });
    runtime.prepare();
    assert.strictEqual(runtime.flow.getPhase(), 'menu', 'prepare must not start the run');
    assert.strictEqual(runtime.spawner.getAliveCount(), 0, 'no enemies before start');

    runtime.start();
    assert.strictEqual(runtime.flow.getPhase(), 'playing');
    assert.strictEqual(runtime.spawner.getAliveCount(), 1);

    const [name] = runtime.spawner.getSpawnedNames();
    weapon.fireAt(name, 50);
    assert.strictEqual(runtime.session.getKills(), 1, 'routing wired by prepare is active after start');
  });

  test('stop detaches routing and spawning', () => {
    const { weapon, runtime } = makeRuntime({ totalWaves: 2, perWave: 1 });
    runtime.start();
    runtime.stop();
    const scoreBefore = runtime.session.getScore();
    const [name] = runtime.spawner.getSpawnedNames();
    weapon.fireAt(name, 50);
    assert.strictEqual(runtime.session.getScore(), scoreBefore, 'damage routing detached');
    assert.strictEqual(runtime.isRunning(), false);
  });
});
