import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { NavGrid } from './GridPathfinder.js';
import { bakeWalkability } from './NavBake.js';
import { NavAgent } from './NavAgent.js';

const DT = 1 / 60;

function agent(
  scene: Scene,
  name: string,
  x: number,
  z: number,
  grid: NavGrid,
  options?: Record<string, unknown>
): NavAgent {
  const go = new GameObject(name);
  go.transform.setPosition(x, 0, z);
  const agent = go.addComponent(new NavAgent({ grid, ...(options as object) }));
  scene.addGameObject(go);
  return agent;
}

function stepAll(scene: Scene, frames: number): void {
  for (let i = 0; i < frames; i++) {
    for (const go of scene.gameObjects) go.update(DT);
  }
}

describe('NavAgent — routing, arrival, links', () => {
  test('routes around a wall and arrives', () => {
    const scene = new Scene('Test');
    const { grid } = bakeWalkability(16, 16, [{ x: 7.5, z: 7.5, hx: 4, hz: 0.5 }], { agentRadius: 0.3 });
    const a = agent(scene, 'A', 1, 1, grid, { speed: 4 });
    assert.strictEqual(a.setDestination(14, 14), true);
    assert.ok(a.path.length > 0);
    stepAll(scene, 600);
    assert.strictEqual(a.arrived, true);
    const p = scene.findByName('A')!.transform.position;
    assert.ok(Math.hypot(p.x - 14, p.z - 14) < 1.0, `at (${p.x}, ${p.z})`);
  });

  test('no path and gridless destinations fail cleanly', () => {
    const scene = new Scene('Test');
    const grid = new NavGrid(4, 4);
    grid.setRectBlocked(0, 0, 3, 3);
    const a = agent(scene, 'A', 0.5, 0.5, grid);
    assert.strictEqual(a.setDestination(3.5, 3.5), false);
    const scene2 = new Scene('Test2');
    const go = new GameObject('B');
    const b = go.addComponent(new NavAgent());
    scene2.addGameObject(go);
    assert.strictEqual(b.setDestination(1, 1), false);
  });

  test('off-mesh link crosses a gap and replans to the goal', () => {
    const scene = new Scene('Test');
    // Full-height chasm (columns 4-7); endpoints sit on open cells.
    const { grid } = bakeWalkability(12, 6, [{ x: 5.5, z: 2.5, hx: 1.5, hz: 3 }], { agentRadius: 0 });
    const a = agent(scene, 'A', 1, 2.5, grid, {
      speed: 3,
      links: [{ ax: 3.5, az: 2.5, bx: 8.5, bz: 2.5, radius: 0.8, traverseTime: 0.5 }]
    });
    assert.strictEqual(a.setDestination(10, 2.5), true);
    let sawTraversal = false;
    for (let i = 0; i < 600; i++) {
      for (const go of scene.gameObjects) go.update(DT);
      if (a.traversing) sawTraversal = true;
      if (a.arrived) break;
    }
    assert.strictEqual(sawTraversal, true);
    assert.strictEqual(a.arrived, true);
    const p = scene.findByName('A')!.transform.position;
    assert.ok(Math.hypot(p.x - 10, p.z - 2.5) < 1.0);
    assert.ok(Math.abs(p.y) < 1e-9, 'lands back at ground height');
  });

  test('N-way head-on crossing: zero stuck, no NaN, min separation', () => {
    const scene = new Scene('Test');
    const grid = new NavGrid(20, 20);
    const agents: NavAgent[] = [];
    const starts: Array<[number, number, number, number]> = [
      [2, 10, 17, 10],
      [17, 10, 2, 10],
      [10, 2, 10, 17],
      [10, 17, 10, 2]
    ];
    for (let i = 0; i < starts.length; i++) {
      const [sx, sz, gx, gz] = starts[i];
      const a = agent(scene, `A${i}`, sx, sz, grid, { speed: 3, separationWeight: 2 });
      assert.strictEqual(a.setDestination(gx, gz), true);
      agents.push(a);
    }
    // Shared neighbor sampler: every other live agent.
    for (const a of agents) {
      a.setNeighborSampler(self => {
        const owner = (self as NavAgent & { gameObject: GameObject }).gameObject;
        const out: Array<{ x: number; z: number }> = [];
        for (const other of scene.gameObjects) {
          if (other === owner) continue;
          out.push({ x: other.transform.position.x, z: other.transform.position.z });
        }
        return out;
      });
    }
    let minSep = Infinity;
    for (let i = 0; i < 1200; i++) {
      for (const go of scene.gameObjects) go.update(DT);
      for (let k = 0; k < agents.length; k++) {
        for (let j = k + 1; j < agents.length; j++) {
          const pa = scene.gameObjects[k].transform.position;
          const pb = scene.gameObjects[j].transform.position;
          assert.ok(Number.isFinite(pa.x + pa.z + pb.x + pb.z), 'no NaN');
          minSep = Math.min(minSep, Math.hypot(pa.x - pb.x, pa.z - pb.z));
        }
      }
      if (agents.every(a => a.arrived)) break;
    }
    assert.ok(agents.every(a => a.arrived), 'all agents arrived (zero stuck)');
    assert.ok(minSep > 0.05, `min separation ${minSep}`);
  });

  test('serializes route state', () => {
    const scene = new Scene('Test');
    const grid = new NavGrid(10, 10);
    const a = agent(scene, 'A', 0.5, 0.5, grid, { speed: 2 });
    assert.strictEqual(a.setDestination(8.5, 8.5), true);
    stepAll(scene, 30);
    const json = a.toJSON();
    assert.strictEqual(json.type, 'NavAgent');
    const scene2 = new Scene('Restore');
    const go = new GameObject('A2');
    const b = go.addComponent(new NavAgent({ grid }));
    scene2.addGameObject(go);
    b.fromJSON(JSON.parse(JSON.stringify(json)));
    assert.strictEqual(b.speed, 2);
    assert.strictEqual(b.arrived, a.arrived);
    assert.deepStrictEqual(b.path, a.path);
  });
});
