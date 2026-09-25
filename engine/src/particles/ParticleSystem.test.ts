import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { ParticleSystem } from './ParticleSystem.js';

const DT = 1 / 60;

function emitter(options?: Record<string, unknown>): { scene: Scene; go: GameObject; ps: ParticleSystem } {
  const scene = new Scene('Test');
  const go = new GameObject('Emitter');
  go.transform.setPosition(0, 2, 0);
  const ps = go.addComponent(new ParticleSystem(options as never));
  scene.addGameObject(go);
  return { scene, go, ps };
}

function step(ps: ParticleSystem, frames: number): void {
  for (let i = 0; i < frames; i++) ps.update(DT);
}

describe('ParticleSystem (CPU-sim ring, single draw)', () => {
  test('emits at rate and holds steady state', () => {
    const { ps } = emitter({ rate: 60, lifetimeMin: 10, lifetimeMax: 10, seed: 7 });
    step(ps, 60);
    assert.strictEqual(ps.aliveCount, 60);
    step(ps, 60);
    assert.strictEqual(ps.aliveCount, 120);
  });

  test('lifetime expiry caps the pool at rate x lifetime', () => {
    const { ps } = emitter({ rate: 60, lifetimeMin: 0.5, lifetimeMax: 0.5, seed: 7 });
    step(ps, 600);
    // Steady state: 60/s x 0.5s = 30 alive (Euler/discrete rounding ±1).
    assert.ok(ps.aliveCount >= 28 && ps.aliveCount <= 32, `alive=${ps.aliveCount}`);
  });

  test('maxParticles caps emission', () => {
    const { ps } = emitter({ rate: 10000, maxParticles: 10, lifetimeMin: 10, lifetimeMax: 10 });
    step(ps, 30);
    assert.strictEqual(ps.aliveCount, 10);
  });

  test('burst fires once on start; loop restarts on duration', () => {
    const { ps } = emitter({ rate: 0, burst: 5, duration: 1, loop: true, lifetimeMin: 10, lifetimeMax: 10 });
    assert.strictEqual(ps.aliveCount, 5); // start() burst
    step(ps, 60);
    assert.strictEqual(ps.aliveCount, 10); // one loop restart + burst
  });

  test('non-looping duration stops emission, particles drain', () => {
    const { ps } = emitter({ rate: 60, duration: 1, loop: false, lifetimeMin: 10, lifetimeMax: 10 });
    step(ps, 120);
    assert.strictEqual(ps.aliveCount, 60);
    assert.strictEqual(ps.emitting, false);
  });

  test('gravity integrates semi-implicit Euler (analytic check)', () => {
    const { ps } = emitter({
      rate: 0,
      burst: 1,
      direction: [0, 1, 0],
      spread: 0,
      speedMin: 2,
      speedMax: 2,
      gravity: 9.8,
      drag: 0,
      lifetimeMin: 10,
      lifetimeMax: 10,
      seed: 1
    });
    // start() burst spawned 1 particle at y=2 with v=2 up.
    step(ps, 60);
    assert.strictEqual(ps.aliveCount, 1);
    const json = ps.toJSON();
    const y = json.pos[1] as number;
    // Semi-implicit Euler, 60 steps of 1/60: y = 2 + 2*1 - 9.8*(dt^2 * 60*61/2).
    const expected = 2 + 2 - 9.8 * ((1 / 60) * (1 / 60) * (60 * 61 / 2));
    assert.ok(Math.abs(y - expected) < 0.05, `y=${y} expected~${expected}`);
  });

  test('identical seeds give identical pools (determinism)', () => {
    const a = emitter({ rate: 40, seed: 99 });
    const b = emitter({ rate: 40, seed: 99 });
    step(a.ps, 120);
    step(b.ps, 120);
    assert.deepStrictEqual(a.ps.toJSON().pos, b.ps.toJSON().pos);
    assert.deepStrictEqual(a.ps.toJSON().vel, b.ps.toJSON().vel);
    const c = emitter({ rate: 40, seed: 100 });
    step(c.ps, 120);
    assert.notDeepStrictEqual(a.ps.toJSON().pos, c.ps.toJSON().pos);
  });

  test('pool stays packed, finite, and single-draw', () => {
    const { ps } = emitter({ rate: 90, seed: 5, shape: 'sphere', shapeSize: [3, 3, 3] });
    step(ps, 600);
    const json = ps.toJSON();
    assert.ok((json.pos as number[]).every(Number.isFinite));
    assert.ok((json.vel as number[]).every(Number.isFinite));
    ps.ensureDraw();
    const points = (ps as unknown as { points: THREE.Points }).points;
    assert.ok(points instanceof THREE.Points);
    const geo = points.geometry as THREE.BufferGeometry;
    assert.strictEqual(geo.drawRange.count, ps.aliveCount);
  });

  test('serialization round-trips pool + RNG state (tolerant to 4dp snapshots)', () => {
    const a = emitter({ rate: 40, seed: 42 });
    step(a.ps, 90);
    const json = a.ps.toJSON();
    assert.strictEqual(json.type, 'ParticleSystem');
    const scene = new Scene('Restore');
    const go = new GameObject('E2');
    go.transform.setPosition(0, 2, 0); // real restores carry transforms (Scene.fromJSON)
    const ps2 = go.addComponent(new ParticleSystem());
    scene.addGameObject(go);
    ps2.fromJSON(JSON.parse(JSON.stringify(json)));
    assert.strictEqual(ps2.aliveCount, a.ps.aliveCount);
    assert.strictEqual(ps2.toJSON().rngState, a.ps.toJSON().rngState);
    step(a.ps, 60);
    step(ps2, 60);
    // Snapshots round to 4dp, so resumed pools agree to snapshot precision
    // (a diverged RNG stream would blow positions apart by orders more).
    const near = (x: number[], y: number[]): boolean =>
      x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) < 1e-3);
    assert.ok(near(ps2.toJSON().pos as number[], a.ps.toJSON().pos as number[]), 'positions resume');
    assert.ok(near(ps2.toJSON().vel as number[], a.ps.toJSON().vel as number[]), 'velocities resume');
  });

  test('play/pause/restart control emission', () => {
    const { ps } = emitter({ rate: 60, lifetimeMin: 10, lifetimeMax: 10, autostart: false });
    step(ps, 60);
    assert.strictEqual(ps.aliveCount, 0);
    ps.play();
    step(ps, 60);
    assert.strictEqual(ps.aliveCount, 60);
    ps.pause();
    step(ps, 60);
    assert.strictEqual(ps.aliveCount, 60); // no deaths, no new spawns
    ps.restart();
    assert.strictEqual(ps.aliveCount, 0);
  });
});
