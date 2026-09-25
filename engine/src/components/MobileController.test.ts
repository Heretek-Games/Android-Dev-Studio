import { test, describe } from 'node:test';
import assert from 'node:assert';
import { MobileController } from './MobileController.js';
import { GameObject } from '../core/GameObject.js';
import { MobileInput } from '../input/MobileInput.js';

function resetInput() {
  MobileInput.instance.setJoystick('left', 0, 0);
  MobileInput.instance.setButton('jump', false);
}

describe('MobileController — dual-stick player movement', () => {
  test('joystick input moves the object and rotates it toward the heading', () => {
    resetInput();
    const go = new GameObject('Hero');
    const controller = go.addComponent(new MobileController({ moveSpeed: 4, rotationSpeed: 10 }));

    MobileInput.instance.setJoystick('left', 1, 0); // full right
    controller.update(0.5);

    assert.strictEqual(controller.isMoving, true);
    assert.ok(go.transform.position.x > 1.5, `expected forward motion on +X, got ${go.transform.position.x}`);
    assert.ok(Math.abs(go.transform.rotation.y) > 0.1, 'should rotate toward the movement direction');
    resetInput();
  });

  test('joystick up (forward) moves along -Z', () => {
    resetInput();
    const go = new GameObject('Hero');
    const controller = go.addComponent(new MobileController({ moveSpeed: 4 }));

    MobileInput.instance.setJoystick('left', 0, 1); // push up
    controller.update(0.5);

    assert.ok(go.transform.position.z < -1.5, `expected forward motion on -Z, got ${go.transform.position.z}`);
    resetInput();
  });

  test('neutral joystick stops movement', () => {
    resetInput();
    const go = new GameObject('Hero');
    const controller = go.addComponent(new MobileController({ moveSpeed: 4 }));

    controller.update(0.5);
    assert.strictEqual(controller.isMoving, false);
    assert.strictEqual(go.transform.position.x, 0);
  });

  test('serializes controller tuning options', () => {
    const controller = new MobileController({ moveSpeed: 7, rotationSpeed: 12, jumpForce: 9 });
    const json = controller.toJSON();
    assert.strictEqual(json.type, 'MobileController');
    assert.strictEqual(json.moveSpeed, 7);
    assert.strictEqual(json.jumpForce, 9);

    const other = new MobileController();
    other.fromJSON(json);
    assert.strictEqual(other.moveSpeed, 7);
  });
});
