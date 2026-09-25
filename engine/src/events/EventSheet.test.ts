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

describe('EventSheet execution trace (debugger core)', () => {
  function tracedScene(): { sheet: EventSheet; ctx: EngineContext } {
    const scene = new Scene('TraceScene');
    const go = new GameObject('Actor');
    const sheet = go.addComponent(new EventSheet([
      {
        id: 'spin',
        name: 'Spin',
        enabled: true,
        conditions: [{ type: 'EveryFrame' }],
        actions: [{ type: 'RotateY', params: { speed: 1 } }]
      },
      {
        id: 'delayed',
        name: 'Delayed',
        enabled: true,
        conditions: [{ type: 'Timer', params: { name: 'd', interval: 1.0 } }],
        actions: [{ type: 'RotateY', params: { degrees: 5 } }]
      },
      {
        id: 'quiet',
        name: 'Never Fires',
        enabled: true,
        conditions: [{ type: 'Timer', params: { name: 'q', interval: 100.0 } }],
        actions: [{ type: 'RotateY', params: { degrees: 5 } }]
      }
    ]));
    scene.addGameObject(go);
    const ctx = new EngineContext();
    ctx.setScene(scene);
    return { sheet, ctx };
  }

  test('fire counts and last-fire ticks track evaluation', () => {
    const { sheet, ctx } = tracedScene();
    // Attach runs the OnStart pass (tick 1); Timer conditions stay false there.
    assert.strictEqual(sheet.fireCount('spin'), 0);
    for (let i = 0; i < 120; i++) ctx.step(1 / 60);
    const trace = sheet.getTrace();
    const spin = trace.find(t => t.eventId === 'spin')!;
    assert.strictEqual(spin.fireCount, 120);
    assert.strictEqual(spin.lastFireTick, 121); // 1 start pass + 120 updates
    assert.strictEqual(spin.evalCount, 121);
    const delayed = trace.find(t => t.eventId === 'delayed')!;
    assert.strictEqual(delayed.fireCount, 2); // 2s at a 1.0s interval
    const quiet = trace.find(t => t.eventId === 'quiet')!;
    assert.strictEqual(quiet.fireCount, 0);
    assert.strictEqual(quiet.lastFireTick, -1);
    // Lookup by name agrees with lookup by id.
    assert.strictEqual(sheet.fireCount('Delayed'), 2);
    assert.strictEqual(sheet.fireCount('nope'), 0);
  });

  test('condition outcomes record pass/fail with a capped ring', () => {
    const { sheet, ctx } = tracedScene();
    for (let i = 0; i < 20; i++) ctx.step(1 / 60);
    const trace = sheet.getTrace();
    const spinCond = trace.find(t => t.eventId === 'spin')!.conditions[0];
    assert.strictEqual(spinCond.lastResult, true);
    assert.strictEqual(spinCond.evalCount, 21);
    assert.ok(spinCond.recent.length <= 8);
    assert.ok(spinCond.recent.every(Boolean));
    const quietCond = trace.find(t => t.eventId === 'quiet')!.conditions[0];
    assert.strictEqual(quietCond.lastResult, false);
  });

  test('disabled events never evaluate or fire', () => {
    const { sheet, ctx } = tracedScene();
    const spin = sheet.events.find(e => e.id === 'spin')!;
    spin.enabled = false;
    for (let i = 0; i < 60; i++) ctx.step(1 / 60);
    const record = sheet.getTrace().find(t => t.eventId === 'spin')!;
    assert.strictEqual(record.fireCount, 0);
    // Only the attach-time OnStart pass (which ran while still enabled).
    assert.strictEqual(record.evalCount, 1);
  });

  test('reset clears records; trace survives JSON round-trip', () => {
    const { sheet, ctx } = tracedScene();
    for (let i = 0; i < 60; i++) ctx.step(1 / 60);
    assert.strictEqual(sheet.fireCount('spin'), 60);
    sheet.resetTrace();
    assert.strictEqual(sheet.fireCount('spin'), 0);
    assert.deepStrictEqual(sheet.getTrace().find(t => t.eventId === 'spin')!.conditions[0].recent, []);

    for (let i = 0; i < 30; i++) ctx.step(1 / 60);
    const json = JSON.stringify(sheet.toJSON());
    const restored = new EventSheet();
    restored.fromJSON(JSON.parse(json));
    assert.strictEqual(restored.fireCount('spin'), 30);
    assert.strictEqual(restored.fireCount('delayed'), 0);
    const cond = restored.getTrace().find(t => t.eventId === 'spin')!.conditions[0];
    assert.strictEqual(cond.lastResult, true);
  });
});
