import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { TrafficSystem } from './TrafficSystem.js';
import { SpatialGrid } from '../spatial/SpatialGrid.js';

const DT = 1 / 60;

describe('TrafficSystem — ambient traffic & pedestrian navigation', () => {
  test('agents follow waypoint routes via behavior-tree decisions', () => {
    const traffic = new TrafficSystem();
    const agent = traffic.registerAgent({
      id: 'car_1',
      name: 'Car 1',
      kind: 'vehicle',
      position: { x: 0, y: 0.6, z: 0 },
      speed: 5,
      waypoints: [
        { x: 10, z: 0 },
        { x: 10, z: 10 }
      ]
    });

    for (let i = 0; i < 600; i++) traffic.update(DT);

    assert.ok(agent.arrived, 'agent should finish its route');
    assert.strictEqual(agent.waypointIndex, 1, 'waypoint index should advance to the last waypoint');
    const finalDistance = Math.hypot(agent.position.x - 10, agent.position.z - 10);
    assert.ok(
      finalDistance <= 1.6,
      `agent should end within the arrival radius of the final waypoint, got ${finalDistance.toFixed(2)}m away`
    );
    assert.ok(traffic.getStats().waypointsReached >= 2, 'both waypoints should be registered as reached');
  });

  test('scene-bound agents spawn GameObjects whose transforms track movement', () => {
    const scene = new Scene('TrafficScene');
    const traffic = new TrafficSystem(scene);
    const agent = traffic.registerAgent({
      id: 'ped_1',
      kind: 'pedestrian',
      position: { x: 0, y: 0.9, z: 0 },
      speed: 3,
      waypoints: [{ x: 5, z: 0 }]
    });

    const go = scene.findByName('Traffic: ped_1');
    assert.ok(go, 'agent GameObject should be spawned');
    assert.strictEqual(go!.id, agent.gameObjectId);

    for (let i = 0; i < 180; i++) traffic.update(DT);

    assert.ok(go!.transform.position.x > 2, `GameObject should track the agent, x=${go!.transform.position.x.toFixed(2)}`);
  });

  test('dynamic obstacle avoidance keeps crossing agents separated', () => {
    const traffic = new TrafficSystem();
    const a = traffic.registerAgent({
      id: 'a',
      kind: 'pedestrian',
      position: { x: -10, y: 0, z: 0 },
      speed: 4,
      radius: 0.6,
      waypoints: [{ x: 10, z: 0 }]
    });
    const b = traffic.registerAgent({
      id: 'b',
      kind: 'pedestrian',
      position: { x: 0, y: 0, z: -10 },
      speed: 4,
      radius: 0.6,
      waypoints: [{ x: 0, z: 10 }]
    });

    let minDistance = Infinity;
    for (let i = 0; i < 900; i++) {
      traffic.update(DT);
      const d = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
      minDistance = Math.min(minDistance, d);
    }

    assert.ok(minDistance > 0.4, `agents should not overlap, min distance was ${minDistance.toFixed(3)}m`);
    assert.ok(a.arrived && b.arrived, 'both agents should still complete their routes (no deadlock)');
  });

  test('spatial-grid perception scales to many agents without overlaps', () => {
    const traffic = new TrafficSystem();
    const grid = new SpatialGrid(8);
    const agents = [];
    for (let i = 0; i < 30; i++) {
      const agent = traffic.registerAgent({
        id: `car_${i}`,
        kind: 'vehicle',
        position: { x: -20 + i * 0.8, y: 0.6, z: -30 },
        speed: 6,
        radius: 1.2,
        waypoints: [{ x: -20 + i * 0.8, z: 30 }]
      });
      grid.insert(agent.id, agent.position.x, agent.position.y, agent.position.z, agent);
      agents.push(agent);
    }

    for (let i = 0; i < 420; i++) traffic.update(DT, grid);

    assert.strictEqual(grid.size, 30, 'grid should track all agents');
    const stats = traffic.getStats();
    assert.strictEqual(stats.total, 30);

    let minPairwise = Infinity;
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const d = Math.hypot(
          agents[i].position.x - agents[j].position.x,
          agents[i].position.z - agents[j].position.z
        );
        minPairwise = Math.min(minPairwise, d);
      }
    }
    assert.ok(minPairwise > 0.5, `vehicles should keep separation at scale, min gap ${minPairwise.toFixed(3)}m`);
  });

  test('unregister removes the agent and its scene GameObject', () => {
    const scene = new Scene('CleanupScene');
    const traffic = new TrafficSystem(scene);
    const agent = traffic.registerAgent({
      id: 'temp',
      position: { x: 0, y: 0, z: 0 },
      waypoints: [{ x: 1, z: 0 }]
    });
    assert.ok(scene.findByName('Traffic: temp'));
    assert.ok(traffic.unregisterAgent(agent.id));
    assert.strictEqual(scene.findByName('Traffic: temp'), null);
    assert.strictEqual(traffic.getAllAgents().length, 0);
  });
});
