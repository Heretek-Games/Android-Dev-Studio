import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { MobileInput } from './MobileInput.js';
import { InputActionMap } from './InputActionMap.js';

describe('InputActionMap — named actions over MobileInput', () => {
  beforeEach(() => {
    MobileInput.instance.reset();
  });

  test('button actions read keys and named buttons', () => {
    const map = new InputActionMap({
      actions: {
        jump: { type: 'button', bindings: [{ source: 'key', code: 'Space' }, { source: 'button', code: 'jump' }] },
        fire: { type: 'button', bindings: [{ source: 'key', code: 'KeyF' }] }
      }
    });
    assert.strictEqual(map.getButton('jump'), false);
    MobileInput.instance.setKey('Space', true);
    assert.strictEqual(map.getButton('jump'), true);
    MobileInput.instance.setKey('Space', false);
    MobileInput.instance.setButton('jump', true);
    assert.strictEqual(map.getButton('jump'), true);
    assert.strictEqual(map.getButton('fire'), false);
    assert.strictEqual(map.getButton('nope'), false);
  });

  test('axis2 composites normalize diagonals (WASD)', () => {
    const map = new InputActionMap({
      actions: {
        move: {
          type: 'axis2',
          bindings: [
            { source: 'key', code: 'KeyW', output2: [0, 1] },
            { source: 'key', code: 'KeyS', output2: [0, -1] },
            { source: 'key', code: 'KeyA', output2: [-1, 0] },
            { source: 'key', code: 'KeyD', output2: [1, 0] }
          ]
        }
      }
    });
    MobileInput.instance.setKey('KeyW', true);
    assert.deepStrictEqual(map.getAxis2('move'), { x: 0, y: 1 });
    MobileInput.instance.setKey('KeyD', true);
    const diag = map.getAxis2('move');
    assert.ok(Math.abs(Math.hypot(diag.x, diag.y) - 1) < 1e-9, `diagonal normalized: ${JSON.stringify(diag)}`);
    assert.ok(diag.x > 0.7 && diag.y > 0.7);
  });

  test('sticks honor radial deadzones', () => {
    const map = new InputActionMap({
      actions: {
        look: { type: 'axis2', deadzone: 0.2, bindings: [{ source: 'stick', code: 'right' }] },
        strafe: { type: 'axis1', deadzone: 0.2, bindings: [{ source: 'stick', code: 'left', axis: 'x' }] }
      }
    });
    MobileInput.instance.setJoystick('right', 0.1, 0);
    assert.deepStrictEqual(map.getAxis2('look'), { x: 0, y: 0 });
    MobileInput.instance.setJoystick('right', 0.6, 0);
    const look = map.getAxis2('look');
    assert.ok(look.x > 0.4 && look.x <= 0.6, `rescaled: ${look.x}`);
    MobileInput.instance.setJoystick('left', 0.05, 0);
    assert.strictEqual(map.getAxis1('strafe'), 0);
  });

  test('gamepad snapshot drives buttons and axes headless', () => {
    const map = new InputActionMap({
      actions: {
        jump: { type: 'button', bindings: [{ source: 'gamepad-button', code: 'a' }] },
        slide: { type: 'button', bindings: [{ source: 'gamepad-button', code: 'pad7' }] },
        steer: { type: 'axis1', bindings: [{ source: 'gamepad-axis', code: 'axis0' }] }
      }
    });
    map.setGamepadSnapshot([0.8, 0, 0, 0], [true, false, false, false, false, false, false, true]);
    assert.strictEqual(map.getButton('jump'), true);
    assert.strictEqual(map.getButton('slide'), true);
    // Axial deadzone rescales: (0.8 - 0.15) / (1 - 0.15).
    assert.ok(Math.abs(map.getAxis1('steer') - 0.65 / 0.85) < 1e-9);
  });

  test('rebinding uses the override layer with conflict reports', () => {
    const map = new InputActionMap({
      actions: {
        jump: { type: 'button', bindings: [{ source: 'key', code: 'Space' }] },
        fire: { type: 'button', bindings: [{ source: 'key', code: 'KeyF' }] }
      }
    });
    const clash = map.rebind('fire', 0, { source: 'key', code: 'Space' });
    assert.strictEqual(clash.ok, false);
    assert.deepStrictEqual(clash.conflicts, ['jump']);
    // Defaults untouched by the refused rebind.
    MobileInput.instance.setKey('KeyF', true);
    assert.strictEqual(map.getButton('fire'), true);
    const forced = map.rebind('fire', 0, { source: 'key', code: 'Space' }, true);
    assert.strictEqual(forced.ok, true);
    MobileInput.instance.setKey('Space', true);
    assert.strictEqual(map.getButton('fire'), true);
    assert.deepStrictEqual(map.findConflicts(), [
      { source: 'key', code: 'space', actions: ['fire', 'jump'] }
    ]);
    map.resetOverrides('fire');
    assert.deepStrictEqual(map.findConflicts(), []);
  });

  test('scripted injection overrides polls for a frame budget', () => {
    const map = new InputActionMap({
      actions: {
        jump: { type: 'button', bindings: [{ source: 'key', code: 'Space' }] },
        move: { type: 'axis2', bindings: [{ source: 'key', code: 'KeyW', output2: [0, 1] }] }
      }
    });
    map.inject('jump', true, 2);
    map.inject('move', { x: 1, y: 0 }, 2);
    assert.strictEqual(map.getButton('jump'), true);
    assert.deepStrictEqual(map.getAxis2('move'), { x: 1, y: 0 });
    map.endFrame();
    assert.strictEqual(map.getButton('jump'), true);
    map.endFrame();
    assert.strictEqual(map.getButton('jump'), false);
    assert.deepStrictEqual(map.getAxis2('move'), { x: 0, y: 0 });
  });

  test('serialization round-trips actions and overrides', () => {
    const map = new InputActionMap({
      actions: {
        jump: { type: 'button', bindings: [{ source: 'key', code: 'Space' }] }
      }
    });
    map.rebind('jump', 0, { source: 'key', code: 'KeyJ' }, true);
    const json = map.toJSON();
    assert.strictEqual(json.type, 'InputActionMap');
    const other = new InputActionMap();
    other.fromJSON(JSON.parse(JSON.stringify(json)));
    assert.strictEqual(other.hasAction('jump'), true);
    MobileInput.instance.setKey('KeyJ', true);
    assert.strictEqual(other.getButton('jump'), true);
    assert.strictEqual(map.getButton('jump'), true);
    map.resetOverrides();
    assert.strictEqual(map.getButton('jump'), false);
    assert.strictEqual(other.getButton('jump'), true);
  });
});
