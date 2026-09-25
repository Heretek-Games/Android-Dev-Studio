import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { PlatformerCharacter } from './PlatformerCharacter.js';
import { Platform } from './Platform.js';

const DT = 1 / 60;

function hero(options?: Record<string, unknown>): { go: GameObject; pc: PlatformerCharacter } {
  const go = new GameObject('Hero');
  go.transform.setPosition(0, 5, 0);
  const pc = go.addComponent(new PlatformerCharacter(options as never));
  return { go, pc };
}

function platform(name: string, x: number, topY: number, w = 10): GameObject {
  const go = new GameObject(name);
  go.transform.setPosition(x, topY - 0.5, 0);
  go.addComponent(new MeshRenderer({ shape: 'box', size: [w, 1, 4], color: '#555555' }));
  go.addComponent(new Platform());
  return go;
}

function step(pc: PlatformerCharacter, frames: number): void {
  for (let i = 0; i < frames; i++) pc.update(DT);
}

describe('PlatformerCharacter + Platform behaviors', () => {
  test('falls and lands on the ground plane', () => {
    const scene = new Scene('Test');
    const { go, pc } = hero({ simulate: { x: 0, jump: false } });
    scene.addGameObject(go);
    step(pc, 120);
    assert.strictEqual(go.transform.position.y, 0);
    assert.strictEqual(pc.isGrounded, true);
  });

  test('jump rises and re-lands', () => {
    const scene = new Scene('Test');
    const { go, pc } = hero({ simulate: { x: 0, jump: false } });
    scene.addGameObject(go);
    step(pc, 120);
    let peak = 0;
    pc.simulate = { x: 0, jump: true };
    pc.update(DT);
    pc.simulate = { x: 0, jump: false };
    for (let i = 0; i < 120; i++) {
      pc.update(DT);
      peak = Math.max(peak, go.transform.position.y);
    }
    assert.ok(peak > 0.5, `expected liftoff, peak=${peak}`);
    assert.strictEqual(go.transform.position.y, 0);
  });

  test('double jump reaches higher than single jump', () => {
    const mk = () => {
      const scene = new Scene('Test');
      const { go, pc } = hero({ simulate: { x: 0, jump: false }, maxJumps: 2 });
      scene.addGameObject(go);
      return { go, pc };
    };
    const single = mk();
    step(single.pc, 120);
    single.pc.simulate = { x: 0, jump: true };
    single.pc.update(DT);
    single.pc.simulate = { x: 0, jump: false };
    let peakSingle = 0;
    for (let i = 0; i < 120; i++) {
      single.pc.update(DT);
      peakSingle = Math.max(peakSingle, single.go.transform.position.y);
    }

    const dbl = mk();
    step(dbl.pc, 120);
    let peakDouble = 0;
    for (let i = 0; i < 120; i++) {
      dbl.pc.simulate = { x: 0, jump: i === 10 || i === 30 };
      dbl.pc.update(DT);
      peakDouble = Math.max(peakDouble, dbl.go.transform.position.y);
    }
    assert.ok(peakDouble > peakSingle + 0.3, `double ${peakDouble} vs single ${peakSingle}`);
  });

  test('lands on platform tops and runs across', () => {
    const scene = new Scene('Test');
    scene.addGameObject(platform('Floor', 0, 2));
    const { go, pc } = hero({ simulate: { x: 1, jump: false } });
    go.transform.setPosition(-4, 5, 0);
    scene.addGameObject(go);
    step(pc, 60);
    // Landed on the deck mid-crossing (later it walks off the far edge).
    assert.strictEqual(go.transform.position.y, 2);
    assert.ok(go.transform.position.x > -4 && go.transform.position.x < 5);
    assert.strictEqual(pc.isGrounded, true);
  });

  test('jumpthru passed from below, landed from above', () => {
    const scene = new Scene('Test');
    const plat = platform('Cloud', 0, 3);
    plat.getComponent(Platform)!.platformType = 'jumpthru';
    scene.addGameObject(plat);
    const { go, pc } = hero({ simulate: { x: 0, jump: false }, jumpForce: 12 });
    go.transform.setPosition(0, 0, 0);
    scene.addGameObject(go);
    step(pc, 10);
    // Jump up through the cloud.
    pc.simulate = { x: 0, jump: true };
    pc.update(DT);
    pc.simulate = { x: 0, jump: false };
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      pc.update(DT);
      peak = Math.max(peak, go.transform.position.y);
    }
    assert.ok(peak > 3, `expected pass-through rise, peak=${peak}`);
    assert.strictEqual(go.transform.position.y, 3);
  });

  test('serializes tuning options', () => {
    const pc = new PlatformerCharacter({ moveSpeed: 7, maxJumps: 2, coyoteTime: 0.2 });
    const json = pc.toJSON();
    assert.strictEqual(json.type, 'PlatformerCharacter');
    assert.strictEqual(json.maxJumps, 2);
    const other = new PlatformerCharacter();
    other.fromJSON(json);
    assert.strictEqual(other.moveSpeed, 7);
    assert.strictEqual(other.coyoteTime, 0.2);

    const plat = new Platform({ platformType: 'jumpthru' });
    assert.strictEqual(plat.toJSON().platformType, 'jumpthru');
  });
});
