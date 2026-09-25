import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FloatingOrigin } from './FloatingOrigin.js';
import { Scene } from './Scene.js';
import { GameObject } from './GameObject.js';

describe('FloatingOrigin Subsystem', () => {
  it('triggers shift when tracking target exceeds distance threshold', () => {
    const origin = new FloatingOrigin({ thresholdDistance: 100 });
    const scene = new Scene();

    const player = new GameObject('Player Hero');
    player.transform.setPosition(150, 0, 0); // exceeds 100
    scene.addGameObject(player);

    const rock = new GameObject('Rock Prop');
    rock.transform.setPosition(160, 0, 20);
    scene.addGameObject(rock);

    origin.setTarget(player);

    let shiftFired = false;
    origin.addListener((delta, cumulative) => {
      shiftFired = true;
      assert.strictEqual(delta.x, 150);
      assert.strictEqual(cumulative.x, 150);
    });

    const shifted = origin.checkAndShift(scene);
    assert.strictEqual(shifted, true);
    assert.strictEqual(shiftFired, true);

    // Player position should now be reset near origin x = 0
    assert.strictEqual(player.transform.position.x, 0);
    // Rock position should be shifted by -150: 160 - 150 = 10
    assert.strictEqual(rock.transform.position.x, 10);
    assert.strictEqual(rock.transform.position.z, 20);

    // Global coordinate conversion should match original
    const globalPos = origin.toGlobal(player.transform.position);
    assert.strictEqual(globalPos.x, 150);
  });

  it('does not shift when player is within threshold', () => {
    const origin = new FloatingOrigin({ thresholdDistance: 100 });
    const scene = new Scene();
    const player = new GameObject('Player Hero');
    player.transform.setPosition(30, 0, 40); // distance 50 < 100
    scene.addGameObject(player);

    origin.setTarget(player);
    const shifted = origin.checkAndShift(scene);
    assert.strictEqual(shifted, false);
    assert.strictEqual(origin.getShiftCount(), 0);
  });
});
