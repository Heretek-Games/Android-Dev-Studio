import { test, describe } from 'node:test';
import assert from 'node:assert';
import { MobileInput } from './MobileInput.js';

describe('MobileInput — headless input state (no DOM required)', () => {
  test('singleton exposes default button state', () => {
    const input = MobileInput.instance;
    assert.strictEqual(MobileInput.instance, input, 'instance is a singleton');
    assert.strictEqual(input.getButton('jump'), false);
    assert.strictEqual(input.getButton('fire'), false);
    assert.strictEqual(input.getButton('action'), false);
    assert.strictEqual(input.getButton('nonexistent'), false);
  });

  test('setButton toggles button state', () => {
    const input = MobileInput.instance;
    input.setButton('jump', true);
    assert.strictEqual(input.getButton('jump'), true);
    input.setButton('jump', false);
    assert.strictEqual(input.getButton('jump'), false);
  });

  test('setJoystick computes angle, distance, and active state', () => {
    const input = MobileInput.instance;
    input.setJoystick('left', 1, 0);

    const left = input.leftJoystick;
    assert.strictEqual(left.isActive, true);
    assert.ok(Math.abs(left.distance - 1) < 1e-6);
    assert.ok(Math.abs(left.angle - 0) < 1e-6, 'angle for +X is 0');

    input.setJoystick('left', 0, 0);
    assert.strictEqual(input.leftJoystick.isActive, false);

    input.setJoystick('right', 0, 1);
    assert.strictEqual(input.rightJoystick.isActive, true);
    input.setJoystick('right', 0, 0);
  });

  test('getAxis reads the left joystick axes', () => {
    const input = MobileInput.instance;
    input.setJoystick('left', 0.5, -0.25);
    assert.ok(Math.abs(input.getAxis('Horizontal') - 0.5) < 1e-6);
    assert.ok(Math.abs(input.getAxis('Vertical') - -0.25) < 1e-6);
    input.setJoystick('left', 0, 0);
  });

  test('touch map supports programmatic touch points (QA harness style)', () => {
    const input = MobileInput.instance;
    input.touches.set(1, { identifier: 1, x: 100, y: 200 } as any);
    assert.strictEqual(input.touches.size, 1);
    input.touches.delete(1);
    assert.strictEqual(input.touches.size, 0);
  });
});
