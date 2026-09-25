import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ALifeSimulator } from './ALifeSimulator.js';
import { Scene } from '../core/Scene.js';

describe('ALifeSimulator (OpenXRay S.T.A.L.K.E.R. Architecture)', () => {
  it('registers agents and tracks stats', () => {
    const alife = new ALifeSimulator({ onlineRadius: 50, offlineTickSeconds: 1.0 });
    alife.registerAgent({
      id: 'agent_1',
      name: 'Stalker Wolf',
      faction: 'loner',
      health: 100,
      maxHealth: 100,
      position: { x: 200, y: 0, z: 200 },
      goal: 'patrol',
      speed: 3.0,
      inventory: { bread: 2 }
    });

    const stats = alife.getStats();
    assert.strictEqual(stats.totalAgents, 1);
    assert.strictEqual(stats.onlineCount, 0);
    assert.strictEqual(stats.offlineCount, 1);
  });

  it('promotes agents to 3D GameObjects when entering the online radius', () => {
    const alife = new ALifeSimulator({ onlineRadius: 50, hysteresisFactor: 1.2 });
    const scene = new Scene();

    alife.registerAgent({
      id: 'agent_near',
      name: 'Bandit Grunt',
      faction: 'bandit',
      health: 80,
      maxHealth: 100,
      position: { x: 30, y: 0, z: 0 }, // 30m away <= 50m online radius
      goal: 'patrol',
      speed: 2.0,
      inventory: {}
    });

    const playerPos = { x: 0, y: 0, z: 0 };
    alife.update(playerPos, 0.1, scene);

    const stats = alife.getStats();
    assert.strictEqual(stats.onlineCount, 1);
    assert.strictEqual(stats.offlineCount, 0);

    const agent = alife.getAgent('agent_near');
    assert.strictEqual(agent?.isOnline, true);
    assert.ok(agent?.gameObjectId);

    const go = scene.findById(agent.gameObjectId!);
    assert.ok(go);
    assert.ok(go.name.includes('Bandit Grunt'));
  });

  it('demotes agents to offline when moving outside the hysteresis radius', () => {
    const alife = new ALifeSimulator({ onlineRadius: 50, hysteresisFactor: 1.2 }); // offline radius = 60
    const scene = new Scene();

    const agent = alife.registerAgent({
      id: 'agent_1',
      name: 'Trader Sidorovich',
      faction: 'loner',
      health: 100,
      maxHealth: 100,
      position: { x: 20, y: 0, z: 0 },
      goal: 'trade',
      speed: 1.0,
      inventory: {}
    });

    // Step 1: inside bubble (20m <= 50m) -> becomes online
    alife.update({ x: 0, y: 0, z: 0 }, 0.1, scene);
    assert.strictEqual(agent.isOnline, true);
    assert.strictEqual(scene.gameObjects.length, 1);

    // Step 2: player moves far away (player at 100, agent at 20 -> dist 80 > 60)
    alife.update({ x: 100, y: 0, z: 0 }, 0.1, scene);
    assert.strictEqual(agent.isOnline, false);
    assert.strictEqual(agent.gameObjectId, undefined);
    assert.strictEqual(scene.gameObjects.length, 0);
  });
});
