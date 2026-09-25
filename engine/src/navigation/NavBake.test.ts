import { test, describe } from 'node:test';
import assert from 'node:assert';
import { bakeWalkability, hasLineOfSight, smoothPath, pathLength } from './NavBake.js';
import { GridPathfinder } from './GridPathfinder.js';

describe('NavBake — erosion, line of sight, funnel smoothing', () => {
  test('obstacles block cells with agent-radius erosion', () => {
    const eroded = bakeWalkability(10, 10, [{ x: 5, z: 5, hx: 1, hz: 1 }], { agentRadius: 0.4 });
    assert.strictEqual(eroded.grid.isBlocked(5, 5), true);
    assert.strictEqual(eroded.grid.isBlocked(0, 0), false);
    assert.strictEqual(eroded.grid.isBlocked(9, 9), false);
    // Erosion monotonicity: bigger radius never unblocks, and covers more.
    const plain = bakeWalkability(10, 10, [{ x: 5, z: 5, hx: 1, hz: 1 }], { agentRadius: 0 });
    const count = (g: { isBlocked(x: number, y: number): boolean }): number => {
      let n = 0;
      for (let z = 0; z < 10; z++) for (let x = 0; x < 10; x++) if (g.isBlocked(x, z)) n++;
      return n;
    };
    assert.ok(count(eroded.grid) >= count(plain.grid));
    const wide = bakeWalkability(10, 10, [{ x: 5, z: 5, hx: 1, hz: 1 }], { agentRadius: 1.5 });
    assert.ok(count(wide.grid) > count(plain.grid));
  });

  test('line of sight respects walls', () => {
    const { grid } = bakeWalkability(10, 10, [{ x: 4.5, z: 0, hx: 0.5, hz: 6 }], { agentRadius: 0 });
    assert.strictEqual(hasLineOfSight(grid, { x: 0, y: 5 }, { x: 2, y: 5 }), true);
    assert.strictEqual(hasLineOfSight(grid, { x: 0, y: 5 }, { x: 9, y: 5 }), false);
  });

  test('smoothing shortens without cutting corners', () => {
    // U-shaped wall forces a detour; smoothing must keep it walkable + shorter.
    const { grid } = bakeWalkability(
      12, 12,
      [
        { x: 5.5, z: 3.5, hx: 3.5, hz: 0.5 },
        { x: 2.5, z: 6.5, hx: 0.5, hz: 3.5 },
        { x: 8.5, z: 6.5, hx: 0.5, hz: 3.5 }
      ],
      { agentRadius: 0 }
    );
    const finder = new GridPathfinder(grid);
    const raw = finder.findPath({ x: 0, y: 0 }, { x: 11, y: 11 });
    assert.ok(raw && raw.length > 2, 'detour exists');
    const smooth = smoothPath(grid, raw);
    assert.ok(smooth.length < raw.length, `${smooth.length} < ${raw.length}`);
    assert.ok(pathLength(smooth) <= pathLength(raw) + 1e-9);
    for (let i = 1; i < smooth.length; i++) {
      assert.strictEqual(hasLineOfSight(grid, smooth[i - 1], smooth[i]), true);
    }
  });
});
