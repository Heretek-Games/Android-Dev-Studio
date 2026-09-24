import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';
import { FoliageInstancer } from './FoliageInstancer.js';

describe('Foliage & Vegetation Instancer', () => {
  it('instantiates foliage instancer with custom config and populates instances', () => {
    const scene = new Scene('TestScene');
    const go = new GameObject('GrassField');
    scene.addGameObject(go);

    const foliage = new FoliageInstancer({
      count: 100,
      radius: 15,
      windSpeed: 4.0,
      windStrength: 0.25,
      grassColor: '#22c55e',
      flowerColor: '#f43f5e'
    });

    go.addComponent(foliage);
    foliage.awake();
    foliage.start();

    assert.strictEqual(foliage.count, 100);
    assert.strictEqual(foliage.radius, 15);
    assert.ok(foliage.batcher !== null);
    assert.strictEqual(foliage.batcher?.activeCount, 100);
    assert.strictEqual(foliage.batcher?.maxCapacity, 100);

    // Verify update ticks wind sway time uniform
    foliage.update(0.016);
    foliage.update(0.016);

    // Cleanup
    foliage.onDestroy();
  });
});
