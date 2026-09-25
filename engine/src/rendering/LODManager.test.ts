import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LODManager } from './LODManager.js';
import { GameObject } from '../core/GameObject.js';

describe('LODManager Subsystem', () => {
  it('registers game objects and updates LOD levels based on distance', () => {
    const lod = new LODManager();
    const closeObj = new GameObject('Close Object');
    const midObj = new GameObject('Mid Object');
    const farObj = new GameObject('Far Object');

    closeObj.transform.setPosition(0, 0, 10);
    midObj.transform.setPosition(0, 0, 40);
    farObj.transform.setPosition(0, 0, 100);

    // Levels: 0 (<20), 1 (<50), 2 (<80), culled (>80)
    lod.register(closeObj, [20, 50, 80]);
    lod.register(midObj, [20, 50, 80]);
    lod.register(farObj, [20, 50, 80]);

    lod.setCameraPosition(0, 0, 0);
    const stats = lod.update();

    assert.strictEqual(stats.registered, 3);
    assert.strictEqual(stats.visible, 2);
    assert.strictEqual(stats.culled, 1);

    assert.strictEqual(lod.getLevel(closeObj.id), 0);
    assert.strictEqual(closeObj.active, true);

    assert.strictEqual(lod.getLevel(midObj.id), 1);
    assert.strictEqual(midObj.active, true);

    assert.strictEqual(lod.getLevel(farObj.id), -1);
    assert.strictEqual(farObj.active, false);
  });

  it('restores active status when unregistering', () => {
    const lod = new LODManager();
    const obj = new GameObject('Test Object');
    obj.transform.setPosition(0, 0, 200);

    lod.register(obj, [50]);
    lod.setCameraPosition(0, 0, 0);
    lod.update();

    assert.strictEqual(obj.active, false);

    lod.unregister(obj.id);
    assert.strictEqual(obj.active, true);
  });
});
