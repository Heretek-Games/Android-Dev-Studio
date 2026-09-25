import { test, describe } from 'node:test';
import assert from 'node:assert';
import { EngineContext } from './EngineContext.js';
import { Scene } from './Scene.js';
import { GameObject } from './GameObject.js';

describe('EngineContext — fixed stepping, time scaling, and tick callbacks', () => {
  test('step advances time, frame count, and updates the scene', () => {
    const ctx = new EngineContext();
    const scene = new Scene('StepScene');
    const go = new GameObject('Ticker');
    let updates = 0;
    go.addComponent({
      gameObject: go,
      enabled: true,
      awake() {},
      start() {},
      update() {
        updates++;
      },
      lateUpdate() {},
      onCollisionEnter() {},
      onDestroy() {},
      toJSON() {
        return { type: 'Ticker' };
      },
      fromJSON() {}
    } as any);
    scene.addGameObject(go);
    ctx.setScene(scene);

    ctx.step(0.5);
    assert.strictEqual(ctx.frameCount, 1);
    assert.ok(Math.abs(ctx.totalTime - 0.5) < 1e-9);
    assert.ok(Math.abs(ctx.deltaTime - 0.5) < 1e-9);
    assert.strictEqual(updates, 1);
  });

  test('timeScale scales the delta passed to the scene', () => {
    const ctx = new EngineContext();
    const scene = new Scene('ScaleScene');
    let received = 0;
    scene.update = ((dt: number) => {
      received = dt;
    }) as any;
    ctx.setScene(scene);

    ctx.timeScale = 0.5;
    ctx.step(1.0);
    assert.ok(Math.abs(received - 0.5) < 1e-9, `expected 0.5s scaled delta, got ${received}`);
    assert.ok(Math.abs(ctx.totalTime - 0.5) < 1e-9);
  });

  test('tick callbacks fire with the scaled delta and can unsubscribe', () => {
    const ctx = new EngineContext();
    const seen: number[] = [];
    const unsubscribe = ctx.onTick(dt => seen.push(dt));

    ctx.step(0.1);
    unsubscribe();
    ctx.step(0.1);

    assert.deepStrictEqual(seen.length, 1);
    assert.ok(Math.abs(seen[0] - 0.1) < 1e-9);
  });

  test('pause and stop manage run state without stepping', () => {
    const ctx = new EngineContext();
    assert.strictEqual(ctx.isRunning, false);
    ctx.start();
    assert.strictEqual(ctx.isRunning, true);
    ctx.pause();
    assert.strictEqual(ctx.isPaused, true);
    ctx.resume();
    assert.strictEqual(ctx.isPaused, false);
    ctx.stop();
    assert.strictEqual(ctx.isRunning, false);
  });
});
