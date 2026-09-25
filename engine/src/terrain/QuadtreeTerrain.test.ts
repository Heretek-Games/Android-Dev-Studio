import { test, describe } from 'node:test';
import assert from 'node:assert';
import { QuadtreeTerrain } from './QuadtreeTerrain.js';

const BOUNDS = { minX: -512, minZ: -512, maxX: 512, maxZ: 512 };

function syncLoader(calls: string[]) {
  return (node: { id: string }) => {
    calls.push(node.id);
  };
}

describe('QuadtreeTerrain — LOD streaming with async loading', () => {
  test('focus outside the bounds keeps a single root leaf', () => {
    const terrain = new QuadtreeTerrain({ ...BOUNDS, maxDepth: 4 });
    terrain.setFocus(4000, 4000);
    const stats = terrain.update();
    assert.strictEqual(stats.leaves, 1);
    assert.strictEqual(stats.maxDepthReached, 0);
  });

  test('focus at the center subdivides to max depth with correct invariants', () => {
    const terrain = new QuadtreeTerrain({ ...BOUNDS, maxDepth: 4, frameBudget: 1000 });
    terrain.setFocus(0, 0);
    terrain.setLoader(syncLoader([]));
    for (let i = 0; i < 20; i++) terrain.update();
    const stats = terrain.getStats();

    assert.strictEqual(stats.maxDepthReached, 4, 'reaches the configured max depth');
    assert.ok(stats.leaves > 64, `deep subdivision near the focus, got ${stats.leaves} leaves`);
    assert.strictEqual(
      stats.lodCounts.reduce((a, b) => a + b, 0),
      stats.leaves,
      'lod distribution accounts for every leaf'
    );

    // Quadtree invariant: every leaf below max depth sits outside its split radius
    for (const leaf of terrain.getVisibleNodes()) {
      if (leaf.depth < 4) {
        assert.ok(
          leaf.distance > leaf.size * terrain.splitDistanceFactor,
          `leaf ${leaf.id} must be outside its split radius (d=${leaf.distance.toFixed(1)}, r=${(leaf.size * 1.6).toFixed(1)})`
        );
      }
    }
  });

  test('hysteresis prevents thrash and merges once far away', () => {
    const terrain = new QuadtreeTerrain({ ...BOUNDS, maxDepth: 2, frameBudget: 100 });
    terrain.setLoader(syncLoader([]));
    terrain.setFocus(700, 700);
    for (let i = 0; i < 6; i++) terrain.update();
    const splitStats = terrain.getStats();
    assert.ok(splitStats.leaves > 1, 'subdivided near the focus');

    // Moving away inside the merge band: no new splits, banded nodes stay split
    terrain.setFocus(1200, 1200);
    terrain.update();
    const bandStats = terrain.getStats();
    assert.ok(bandStats.leaves <= splitStats.leaves, 'no new splits when the focus moves away');
    assert.ok(
      terrain.getVisibleNodes().some(leaf => leaf.id.startsWith('0.3')),
      'the node still inside the merge band stays subdivided'
    );

    // Far beyond the merge radius: collapses back to the root
    terrain.setFocus(6000, 6000);
    for (let i = 0; i < 4; i++) terrain.update();
    assert.strictEqual(terrain.getStats().leaves, 1, 'merged when the focus left the band');
  });

  test('node loading respects the per-frame budget', () => {
    const calls: string[] = [];
    const terrain = new QuadtreeTerrain({ ...BOUNDS, maxDepth: 3, frameBudget: 2 });
    terrain.setLoader(syncLoader(calls));
    terrain.setFocus(0, 0);

    terrain.update();
    assert.ok(calls.length <= 2, `budget should cap loads per update, got ${calls.length}`);

    let previous = terrain.getStats().queued;
    while (terrain.getStats().queued > 0 && previous > 0) {
      const before = calls.length;
      terrain.update();
      assert.ok(calls.length - before <= 2, 'each update processes at most frameBudget nodes');
      previous = terrain.getStats().queued;
    }
    const stats = terrain.getStats();
    assert.strictEqual(stats.queued, 0, 'queue drained');
    assert.strictEqual(stats.loading, 0);
    assert.strictEqual(stats.ready, stats.leaves, 'every leaf finished loading');
  });

  test('async loaders transition loading -> ready on resolution', async () => {
    const resolvers: Array<() => void> = [];
    const terrain = new QuadtreeTerrain({ ...BOUNDS, maxDepth: 1, frameBudget: 100 });
    terrain.setLoader(
      () =>
        new Promise<void>(resolve => {
          resolvers.push(resolve);
        })
    );
    terrain.setFocus(0, 0);
    terrain.update();

    const mid = terrain.getStats();
    assert.strictEqual(mid.loading, 4, 'children are loading while promises are pending');
    assert.strictEqual(mid.ready, 0);

    for (const resolve of resolvers) resolve();
    await Promise.resolve(); // flush microtasks
    const done = terrain.getStats();
    assert.strictEqual(done.loading, 0);
    assert.strictEqual(done.ready, 4);
  });

  test('continuous LOD blend rises as the focus approaches the split band', () => {
    const terrain = new QuadtreeTerrain({ ...BOUNDS, maxDepth: 2, frameBudget: 100 });
    terrain.setLoader(syncLoader([]));
    // Child .0 spans [-512,0]^2; its split radius is 512 × 1.6 = 819.2
    terrain.setFocus(600, 600); // distance ≈ 848.5 → just outside the split radius, inside the blend band
    for (let i = 0; i < 6; i++) terrain.update();

    const leaves = terrain.getVisibleNodes();
    const blendNode = leaves.find(node => node.id === '0.0');
    assert.ok(blendNode, 'child .0 is a leaf (not split) at this distance');
    assert.ok(blendNode!.blend > 0.6 && blendNode!.blend < 1.0, `blend in the transition band, got ${blendNode!.blend}`);
    assert.strictEqual(blendNode!.lod, 1, 'detail level tracks depth');
  });

  test('serialize/restore round-trips the focus state', () => {
    const terrain = new QuadtreeTerrain({ ...BOUNDS, maxDepth: 2, frameBudget: 100 });
    terrain.setLoader(syncLoader([]));
    terrain.setFocus(100, -100);
    for (let i = 0; i < 6; i++) terrain.update();
    const snapshot = terrain.serialize();
    assert.strictEqual(snapshot.focus.x, 100);

    const other = new QuadtreeTerrain({ ...BOUNDS, maxDepth: 2, frameBudget: 100 });
    other.setLoader(syncLoader([]));
    other.restore(snapshot);
    assert.deepStrictEqual(other.getFocus(), { x: 100, z: -100 });
  });
});
