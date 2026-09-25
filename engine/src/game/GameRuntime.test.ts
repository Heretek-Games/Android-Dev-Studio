import { test, describe } from 'node:test';
import assert from 'node:assert';
import { GameRuntime } from './GameRuntime.js';
import { HealthComponent } from '../components/HealthComponent.js';
import { ElementalReactionComponent } from '../combat/ElementalReactionComponent.js';
import { Settlement } from '../simulation/Settlement.js';
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

function makeDistanceRuntime(options: { targetScore?: number; timeLimitSeconds?: number } = {}) {
  const scene = new Scene('DriveArena');
  const player = new GameObject('Player Hero');
  scene.addGameObject(player);
  const runtime = new GameRuntime({
    scene,
    mode: 'distance',
    playerName: 'Player Hero',
    targetScore: options.targetScore ?? 30,
    timeLimitSeconds: options.timeLimitSeconds ?? 60
  });
  return { scene, player, runtime };
}

describe('GameRuntime — distance mode (driving slice)', () => {
  test('start enters playing without spawning enemies', () => {
    const { runtime } = makeDistanceRuntime();
    runtime.start();
    assert.strictEqual(runtime.flow.getPhase(), 'playing');
    assert.strictEqual(runtime.spawner.getAliveCount(), 0);
  });

  test('scores travelled metres and wins at the target', () => {
    const { player, runtime } = makeDistanceRuntime({ targetScore: 30 });
    runtime.start();

    for (let step = 0; step < 40; step++) {
      player.transform.setPosition(step + 1, 0, 0);
      runtime.update(1 / 60);
    }
    assert.strictEqual(runtime.flow.getPhase(), 'won', 'target distance wins');
    // Travel stops at the winning distance: the loop no longer accumulates score.
    assert.ok(Math.abs(runtime.getTraveledDistance() - 30) < 1e-6, `distance=${runtime.getTraveledDistance()}`);
    assert.ok(Math.abs(runtime.session.getScore() - 30) < 1e-6);
  });

  test('loses when the time limit expires before the target', () => {
    const { runtime } = makeDistanceRuntime({ targetScore: 1000, timeLimitSeconds: 2 });
    runtime.start();
    runtime.update(2.5);
    assert.strictEqual(runtime.flow.getPhase(), 'lost');
  });

  test('ignores teleport-sized jumps and non-finite deltas', () => {
    const { player, runtime } = makeDistanceRuntime({ targetScore: 1000 });
    runtime.start();
    player.transform.setPosition(0, 0, 0);
    runtime.update(1 / 60);
    player.transform.setPosition(500, 0, 0);   // far teleport
    runtime.update(1 / 60);
    assert.strictEqual(runtime.getTraveledDistance(), 0);

    player.transform.setPosition(Number.NaN, 0, 0);
    runtime.update(1 / 60);
    assert.strictEqual(runtime.getTraveledDistance(), 0);
  });

  test('restart resets the travelled distance', () => {
    const { player, runtime } = makeDistanceRuntime({ targetScore: 10 });
    runtime.start();
    player.transform.setPosition(5, 0, 0);
    runtime.update(1 / 60);
    player.transform.setPosition(10, 0, 0);
    runtime.update(1 / 60);
    assert.ok(runtime.getTraveledDistance() > 0);

    runtime.restart();
    assert.strictEqual(runtime.getTraveledDistance(), 0);
    assert.strictEqual(runtime.session.getScore(), 0);
    assert.strictEqual(runtime.flow.getPhase(), 'playing');
  });
});

describe('GameRuntime — elemental hits', () => {
  test('setHitElement re-routes weapon hits through the elemental path', () => {
    const scene = new Scene('DungeonArena');
    const player = new GameObject('Adventurer');
    scene.addGameObject(player);
    const enemy = new GameObject('Pyro Slime');
    scene.addGameObject(enemy);
    const elemental = enemy.addComponent(new ElementalReactionComponent());
    elemental.maxHealth = 100;
    elemental.health = 100;
    elemental.receiveElementalAttack('Pyro', 0, 1);

    const weapon = new FakeWeapon();
    const runtime = new GameRuntime({
      scene,
      playerName: 'Adventurer',
      totalWaves: 1,
      weapon,
      hitElement: undefined // physical until the blessing
    });
    runtime.start();

    weapon.fireAt('Pyro Slime', 20);
    assert.strictEqual(runtime.getReactionCount(), 0, 'physical hits produce no reaction');
    assert.strictEqual(elemental.health, 80);

    runtime.setHitElement('Hydro');
    weapon.fireAt('Pyro Slime', 20);
    assert.strictEqual(runtime.getReactionCount(), 1, 'hydro on pyro vaporises');
    assert.strictEqual(elemental.health, 40, 'forward vaporise doubles the damage');
  });
});

function makeBuildRuntime() {
  const scene = new Scene('BuildArena');
  const settlement = new Settlement(8, 6, 500, 20);
  settlement.place('house', 0, 0);
  settlement.place('farm', 1, 0);
  settlement.place('farm', 2, 0);
  settlement.place('market', 3, 0);
  const runtime = new GameRuntime({ scene, mode: 'build', settlement });
  return { scene, settlement, runtime };
}

describe('GameRuntime — build mode (city slice)', () => {
  test('start enters playing without spawning enemies', () => {
    const { runtime } = makeBuildRuntime();
    runtime.start();
    assert.strictEqual(runtime.flow.getPhase(), 'playing');
    assert.strictEqual(runtime.spawner.getAliveCount(), 0);
    assert.strictEqual(runtime.getSettlement()?.snapshot().population, 0);
  });

  test('advancing grows the settlement and wins at the target', () => {
    const { runtime } = makeBuildRuntime();
    runtime.start();
    for (let i = 0; i < 600 && runtime.flow.getPhase() === 'playing'; i++) {
      runtime.update(1 / 60);
    }
    assert.strictEqual(runtime.flow.getPhase(), 'won');
    assert.ok((runtime.getSettlement()?.snapshot().population ?? 0) >= 6);
  });

  test('restart resets the settlement', () => {
    const { runtime } = makeBuildRuntime();
    runtime.start();
    runtime.update(5);
    assert.ok((runtime.getSettlement()?.snapshot().steps ?? 0) > 0);
    runtime.restart();
    assert.strictEqual(runtime.getSettlement()?.snapshot().steps, 0);
    assert.strictEqual(runtime.flow.getPhase(), 'playing');
  });
});
