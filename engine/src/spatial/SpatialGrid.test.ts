import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SpatialGrid } from './SpatialGrid.js';

describe('SpatialGrid 3D Hash', () => {
  it('inserts entities and reports correct statistics', () => {
    const grid = new SpatialGrid(10);
    grid.insert('e1', 5, 0, 5, { name: 'Hero' });
    grid.insert('e2', 25, 0, 25, { name: 'Monster' });

    assert.strictEqual(grid.size, 2);
    const stats = grid.stats();
    assert.strictEqual(stats.entries, 2);
    assert.strictEqual(stats.cells, 2);
  });

  it('queries entries within a radius', () => {
    const grid = new SpatialGrid(10);
    grid.insert('e1', 0, 0, 0);
    grid.insert('e2', 3, 0, 4); // distance 5 from origin
    grid.insert('e3', 10, 0, 10); // distance ~14.14

    const within6 = grid.queryRadius(0, 0, 0, 6);
    assert.strictEqual(within6.length, 2);
    const ids = within6.map(e => e.id);
    assert.ok(ids.includes('e1'));
    assert.ok(ids.includes('e2'));
    assert.ok(!ids.includes('e3'));
  });

  it('finds nearest entity to a point', () => {
    const grid = new SpatialGrid(10);
    grid.insert('far', 20, 0, 0);
    grid.insert('near', 5, 0, 0);
    grid.insert('mid', 10, 0, 0);

    const nearest = grid.nearest(0, 0, 0, 50);
    assert.ok(nearest);
    assert.strictEqual(nearest.id, 'near');
  });

  it('updates position and migrates cell buckets', () => {
    const grid = new SpatialGrid(10);
    grid.insert('mover', 5, 0, 5); // cell 0|0|0

    // Move to cell 3|0|3
    grid.update('mover', 35, 0, 35);
    assert.strictEqual(grid.size, 1);

    const nearOrigin = grid.queryRadius(0, 0, 0, 10);
    assert.strictEqual(nearOrigin.length, 0);

    const nearDest = grid.queryRadius(35, 0, 35, 5);
    assert.strictEqual(nearDest.length, 1);
    assert.strictEqual(nearDest[0].id, 'mover');
  });

  it('removes entities and cleans up empty buckets', () => {
    const grid = new SpatialGrid(10);
    grid.insert('e1', 5, 0, 5);
    grid.remove('e1');

    assert.strictEqual(grid.size, 0);
    assert.strictEqual(grid.stats().cells, 0);
    assert.strictEqual(grid.get('e1'), undefined);
  });
});
