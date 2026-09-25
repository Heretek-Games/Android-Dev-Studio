import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NavGrid, GridPathfinder } from './GridPathfinder.js';

describe('GridPathfinder Hierarchical A*', () => {
  it('finds straightforward paths on open grids', () => {
    const grid = new NavGrid(20, 20);
    const finder = new GridPathfinder(grid, { chunkSize: 4, hierarchical: true });

    const path = finder.findPath({ x: 0, y: 0 }, { x: 5, y: 0 });
    assert.ok(path);
    assert.strictEqual(path.length, 6);
    assert.deepStrictEqual(path[0], { x: 0, y: 0 });
    assert.deepStrictEqual(path[path.length - 1], { x: 5, y: 0 });
  });

  it('navigates around blocked obstacles', () => {
    const grid = new NavGrid(10, 10);
    // Wall from (3, 0) to (3, 7)
    grid.setRectBlocked(3, 0, 3, 7, true);

    const finder = new GridPathfinder(grid, { hierarchical: false });
    const path = finder.findPath({ x: 0, y: 0 }, { x: 6, y: 0 });

    assert.ok(path);
    assert.deepStrictEqual(path[0], { x: 0, y: 0 });
    assert.deepStrictEqual(path[path.length - 1], { x: 6, y: 0 });

    // Path must navigate around the wall (y >= 8)
    const passedAround = path.some(p => p.y >= 8);
    assert.ok(passedAround, 'Path should route around the obstacle wall');
  });

  it('returns null when goal is completely unreachable', () => {
    const grid = new NavGrid(10, 10);
    // Seal off (9, 9)
    grid.setBlocked(8, 9, true);
    grid.setBlocked(9, 8, true);

    const finder = new GridPathfinder(grid);
    const path = finder.findPath({ x: 0, y: 0 }, { x: 9, y: 9 });
    assert.strictEqual(path, null);
  });
});
