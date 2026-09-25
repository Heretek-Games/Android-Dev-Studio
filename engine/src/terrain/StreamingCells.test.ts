import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { HierarchicalStreamingCells, type CellLevelConfig } from './StreamingCells.js';

const TEST_LEVELS: CellLevelConfig[] = [
  { name: 'district', cellSize: 100, ringRadius: 500, drawsPerCell: 1 },
  { name: 'chunk', cellSize: 10, ringRadius: 25, drawsPerCell: 8 }
];

describe('HierarchicalStreamingCells — urban streaming cells', () => {
  test('activates assets inside the ring and culls those beyond it', () => {
    const cells = new HierarchicalStreamingCells({ levels: TEST_LEVELS, hysteresisFactor: 1.25 });
    cells.registerAsset({ id: 'near', x: 5, y: 0, z: 5 });
    cells.registerAsset({ id: 'mid', x: 15, y: 0, z: 5 });
    cells.registerAsset({ id: 'far', x: 80, y: 0, z: 80 });

    cells.setFocus(0, 0, 0);
    const stats = cells.update();

    assert.strictEqual(stats.totalAssets, 3);
    // near (cell 0,0 center 5,5 dist 7.1) + mid (cell 1,0 center 15,5 dist 15.8) are inside 25m
    assert.strictEqual(stats.activeAssets, 2, `expected 2 active, got ${stats.activeAssets}`);
    assert.strictEqual(stats.culledAssets, 1);
  });

  test('hysteresis prevents boundary thrashing', () => {
    const cells = new HierarchicalStreamingCells({ levels: TEST_LEVELS, hysteresisFactor: 1.25 });
    cells.registerAsset({ id: 'edge', x: 15, y: 0, z: 5 }); // cell center at (15, 5), dist ~15.8

    cells.setFocus(0, 0, 0);
    cells.update();
    assert.strictEqual(cells.stats().activeAssets, 1, 'inside ring → active');

    // Push focus so the cell sits between activate (25) and deactivate (31.25) radii
    cells.setFocus(-5, 0, 5); // distance from cell center (15,5) ≈ 20
    cells.update();
    assert.strictEqual(cells.stats().activeAssets, 1, 'still inside deactivate radius');

    // Beyond the deactivate radius → culled
    cells.setFocus(-20, 0, 20);
    cells.update();
    assert.strictEqual(cells.stats().activeAssets, 0, 'beyond deactivate radius → culled');
  });

  test('hierarchical levels stream independently (district outlives chunk)', () => {
    const cells = new HierarchicalStreamingCells({ levels: TEST_LEVELS, hysteresisFactor: 1.25 });
    cells.registerAsset({ id: 'remote', x: 300, y: 0, z: 0 });

    cells.setFocus(300, 0, 0);
    cells.update();
    const stats = cells.stats();
    // chunk level (ring 25) active near the asset; district (ring 500) active too
    assert.strictEqual(stats.activeAssets, 1);
    assert.ok(stats.activeCellsByLevel[0] >= 1, 'district cell active');
    assert.ok(stats.activeCellsByLevel[1] >= 1, 'chunk cell active');

    // Move far away: chunk culled, district ring (500m) still covers the asset's district
    cells.setFocus(700, 0, 0);
    cells.update();
    const farStats = cells.stats();
    assert.strictEqual(farStats.activeAssets, 0, 'remote chunk culled');
    assert.ok(
      farStats.activeCellsByLevel[0] >= 1,
      'district level remains active at long range (draw-distance tiering)'
    );
  });

  test('adaptive draw-budget trimming keeps estimated draws within budget', () => {
    const cells = new HierarchicalStreamingCells({
      levels: [
        { name: 'chunk', cellSize: 10, ringRadius: 40, drawsPerCell: 8 }
      ],
      hysteresisFactor: 1.25,
      drawBudget: 100
    });
    // Dense cluster: 7x7 grid of assets → up to 49 cells × 8 draws = 392 without trimming
    let n = 0;
    for (let x = -30; x <= 30; x += 10) {
      for (let z = -30; z <= 30; z += 10) {
        cells.registerAsset({ id: `asset_${n++}`, x: x + 5, y: 0, z: z + 5 });
      }
    }

    cells.setFocus(0, 0, 0);
    const stats = cells.update();

    assert.ok(stats.estimatedDrawCalls <= 100, `draws within budget, got ${stats.estimatedDrawCalls}`);
    assert.strictEqual(stats.budgetTrimmed, true, 'trimming should be reported for telemetry');
    assert.ok(stats.activeAssets > 0, 'inner cells remain active after trimming');
    assert.ok(stats.culledAssets > 0, 'outer cells are culled by the budget');
  });

  test('scene-bound assets toggle GameObject.active on stream in/out', () => {
    const scene = new Scene('StreamScene');
    const cells = new HierarchicalStreamingCells({ levels: TEST_LEVELS, scene });

    const nearGo = new GameObject('NearBuilding');
    nearGo.transform.setPosition(5, 0, 5);
    scene.addGameObject(nearGo);
    const farGo = new GameObject('FarBuilding');
    farGo.transform.setPosition(80, 0, 80);
    scene.addGameObject(farGo);

    cells.registerAsset({ id: 'near', x: 5, y: 0, z: 5, gameObjectId: nearGo.id });
    cells.registerAsset({ id: 'far', x: 80, y: 0, z: 80, gameObjectId: farGo.id });

    cells.setFocus(0, 0, 0);
    cells.update();
    assert.strictEqual(nearGo.active, true, 'near building active');
    assert.strictEqual(farGo.active, false, 'far building culled');

    cells.setFocus(80, 0, 80);
    cells.update();
    assert.strictEqual(farGo.active, true, 'far building streams in when focus arrives');
  });

  test('assets re-cluster when moved across cell boundaries', () => {
    const cells = new HierarchicalStreamingCells({ levels: TEST_LEVELS });
    cells.registerAsset({ id: 'car', x: 5, y: 0, z: 5 });
    cells.setFocus(0, 0, 0);
    cells.update();
    assert.strictEqual(cells.stats().activeAssets, 1);

    cells.moveAsset('car', 90, 0, 90); // far outside the ring
    cells.update();
    assert.strictEqual(cells.stats().activeAssets, 0, 'moved asset should be culled in its new cell');

    cells.setFocus(90, 0, 90);
    cells.update();
    assert.strictEqual(cells.stats().activeAssets, 1, 'moved asset streams in near the new focus');
  });

  test('flat cell state serializes and restores', () => {
    const cells = new HierarchicalStreamingCells({ levels: TEST_LEVELS });
    cells.registerAsset({ id: 'a', x: 5, y: 0, z: 5 });
    cells.setFocus(0, 0, 0);
    cells.update();
    const snapshot = cells.serialize();

    cells.clear();
    cells.registerAsset({ id: 'a', x: 5, y: 0, z: 5 });
    cells.setFocus(500, 0, 500);
    cells.update();
    assert.strictEqual(cells.stats().activeAssets, 0);

    cells.restore(snapshot);
    const restored = cells.stats();
    assert.strictEqual(restored.focus.x, 0);
    assert.ok(restored.activeCells > 0, 'restored active cells');
  });
});
