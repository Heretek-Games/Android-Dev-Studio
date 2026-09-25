import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { EngineContext } from '../core/EngineContext.js';
import { EventSheet } from './EventSheet.js';

describe('EventSheet Condition/Action Runtime', () => {
  test('timer condition fires after its interval even when the timer was never seeded', () => {
    const scene = new Scene('TimerScene');
    const spinner = new GameObject('Spinner');

    spinner.addComponent(new EventSheet([
      {
        id: 'timer_event',
        name: 'Delayed Spin',
        enabled: true,
        conditions: [{ type: 'Timer', params: { name: 'spin_tick', interval: 1.0 } }],
        actions: [{ type: 'RotateY', params: { degrees: 10 } }]
      }
    ]));
    scene.addGameObject(spinner);

    const ctx = new EngineContext();
    ctx.setScene(scene);

    // Accumulate 0.75s (0.25 is binary-exact): not yet at the 1.0s interval
    for (let i = 0; i < 3; i++) ctx.step(0.25);
    assert.strictEqual(spinner.transform.rotation.y, 0);

    // Crossing the 1.0s boundary fires the event exactly once
    ctx.step(0.25);
    const expected = (10 * Math.PI) / 180;
    assert.ok(Math.abs(spinner.transform.rotation.y - expected) < 1e-9);
  });

  test('timer condition re-fires on every interval elapse (regression: lazy accumulation)', () => {
    const scene = new Scene('TimerRepeatScene');
    const spinner = new GameObject('Spinner');

    spinner.addComponent(new EventSheet([
      {
        id: 'timer_repeat',
        name: 'Repeat Spin',
        enabled: true,
        conditions: [{ type: 'Timer', params: { name: 'tick', interval: 0.5 } }],
        actions: [{ type: 'RotateY', params: { degrees: 5 } }]
      }
    ]));
    scene.addGameObject(spinner);

    const ctx = new EngineContext();
    ctx.setScene(scene);

    // 2.0s at a 0.5s interval -> 4 fires (0.25s steps are binary-exact)
    for (let i = 0; i < 8; i++) ctx.step(0.25);
    const expected = 4 * ((5 * Math.PI) / 180);
    assert.ok(Math.abs(spinner.transform.rotation.y - expected) < 1e-6);
  });

  test('rotateY degrees param rotates a fixed step independent of delta time', () => {
    const scene = new Scene('DegreesScene');
    const spinner = new GameObject('Spinner');

    spinner.addComponent(new EventSheet([
      {
        id: 'start_spin',
        name: 'Fixed Spin',
        enabled: true,
        conditions: [{ type: 'OnStart' }],
        actions: [{ type: 'RotateY', params: { degrees: 90 } }]
      }
    ]));
    scene.addGameObject(spinner);

    const ctx = new EngineContext();
    ctx.setScene(scene);
    ctx.step(0.16); // triggers start() -> OnStart evaluation

    assert.ok(Math.abs(spinner.transform.rotation.y - Math.PI / 2) < 1e-9);
  });

  test('rotateY speed param remains an angular velocity for every-frame spins', () => {
    const scene = new Scene('SpeedScene');
    const spinner = new GameObject('Spinner');

    spinner.addComponent(new EventSheet([
      {
        id: 'frame_spin',
        name: 'Continuous Spin',
        enabled: true,
        conditions: [{ type: 'EveryFrame' }],
        actions: [{ type: 'RotateY', params: { speed: 2.0 } }]
      }
    ]));
    scene.addGameObject(spinner);

    const ctx = new EngineContext();
    ctx.setScene(scene);
    ctx.step(0.5); // 0.5s * 2.0 rad/s = 1.0 rad

    assert.strictEqual(spinner.transform.rotation.y, 1.0);
  });

  test('timer names accumulate independently', () => {
    const scene = new Scene('TimerNamesScene');
    const go = new GameObject('Multi');

    go.addComponent(new EventSheet([
      {
        id: 'fast_tick',
        name: 'Fast',
        enabled: true,
        conditions: [{ type: 'Timer', params: { name: 'fast', interval: 0.25 } }],
        actions: [{ type: 'RotateY', params: { degrees: 1 } }]
      },
      {
        id: 'slow_tick',
        name: 'Slow',
        enabled: true,
        conditions: [{ type: 'Timer', params: { name: 'slow', interval: 1.0 } }],
        actions: [{ type: 'RotateY', params: { degrees: 100 } }]
      }
    ]));
    scene.addGameObject(go);

    const ctx = new EngineContext();
    ctx.setScene(scene);

    // 0.75s: 'fast' (0.25s interval) fires 3x, 'slow' (1.0s) fires 0x
    for (let i = 0; i < 3; i++) ctx.step(0.25);
    const expectedFastOnly = 3 * ((1 * Math.PI) / 180);
    assert.ok(Math.abs(go.transform.rotation.y - expectedFastOnly) < 1e-6);
  });
});
