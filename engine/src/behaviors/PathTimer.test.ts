import { test, describe } from 'node:test';
import assert from 'node:assert';
import { GameObject } from '../core/GameObject.js';
import { Pathfollow } from './Pathfollow.js';
import { Timer } from './Timer.js';

describe('Pathfollow + Timer behaviors', () => {
  test('pathfollow loops waypoints and faces travel', () => {
    const go = new GameObject('Patrol');
    const path = go.addComponent(
      new Pathfollow({
        waypoints: [{ x: -5, z: 0 }, { x: 5, z: 0 }],
        moveSpeed: 5,
        mode: 'loop'
      })
    );
    go.transform.setPosition(-5, 0, 0);
    for (let i = 0; i < 300; i++) path.update(1 / 60);
    // 5s at speed 5 over a 10m leg: multiple legs covered, still on path.
    assert.ok(Math.abs(go.transform.position.x) <= 5.5);
    assert.strictEqual(go.transform.position.y, 0);
    assert.ok(path.waypointIndex === 0 || path.waypointIndex === 1);
  });

  test('pathfollow once finishes at the last waypoint', () => {
    const go = new GameObject('Patrol');
    const path = go.addComponent(
      new Pathfollow({
        waypoints: [{ x: 0, z: 0 }, { x: 4, z: 0 }],
        moveSpeed: 4,
        mode: 'once'
      })
    );
    go.transform.setPosition(0, 0, 0);
    for (let i = 0; i < 300; i++) path.update(1 / 60);
    assert.strictEqual(path.finished, true);
    assert.ok(Math.abs(go.transform.position.x - 4) <= 0.5);
  });

  test('pathfollow pingpong reverses direction', () => {
    const go = new GameObject('Patrol');
    const path = go.addComponent(
      new Pathfollow({
        waypoints: [{ x: -4, z: 0 }, { x: 4, z: 0 }],
        moveSpeed: 8,
        mode: 'pingpong'
      })
    );
    go.transform.setPosition(-4, 0, 0);
    let sawForward = false;
    let sawBackward = false;
    let prevX = -4;
    for (let i = 0; i < 240; i++) {
      path.update(1 / 60);
      const dx = go.transform.position.x - prevX;
      if (dx > 0.01) sawForward = true;
      if (dx < -0.01) sawBackward = true;
      prevX = go.transform.position.x;
    }
    assert.ok(sawForward && sawBackward, 'expected travel in both directions');
  });

  test('timer expires once, repeats on demand', () => {
    const once = new GameObject('Once').addComponent(new Timer({ duration: 1 }));
    for (let i = 0; i < 120; i++) once.update(1 / 60);
    assert.strictEqual(once.expiredCount, 1);
    assert.strictEqual(once.running, false);
    assert.strictEqual(once.progress, 1);

    const loop = new GameObject('Loop').addComponent(new Timer({ duration: 0.5, repeat: true }));
    for (let i = 0; i < 200; i++) loop.update(1 / 60);
    assert.strictEqual(loop.expiredCount, 6);
    assert.strictEqual(loop.running, true);
  });

  test('timer stop/reset behave', () => {
    const go = new GameObject('T');
    const timer = go.addComponent(new Timer({ duration: 1, autostart: false }));
    timer.update(1);
    assert.strictEqual(timer.expiredCount, 0);
    timer.start();
    timer.update(1);
    assert.strictEqual(timer.expiredCount, 1);
    timer.reset();
    assert.strictEqual(timer.expiredCount, 0);
    assert.strictEqual(timer.elapsed, 0);
  });

  test('both serialize round-trip', () => {
    const path = new Pathfollow({ moveSpeed: 7, mode: 'pingpong' });
    const pj = path.toJSON();
    assert.strictEqual(pj.type, 'Pathfollow');
    const path2 = new Pathfollow();
    path2.fromJSON(pj);
    assert.strictEqual(path2.moveSpeed, 7);
    assert.strictEqual(path2.mode, 'pingpong');

    const timer = new Timer({ duration: 2, repeat: true });
    timer.update(2.5);
    const tj = timer.toJSON();
    const timer2 = new Timer();
    timer2.fromJSON(tj);
    assert.strictEqual(timer2.expiredCount, 1);
  });
});
