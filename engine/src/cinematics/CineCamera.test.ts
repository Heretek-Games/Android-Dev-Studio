import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from '../core/Scene.js';
import { GameObject } from '../core/GameObject.js';
import { CameraComponent } from '../components/CameraComponent.js';
import { TimelineLite } from './TimelineLite.js';
import { CineCamera } from './CineCamera.js';
import { smoothDamp, catmullRomPoint, traumaNoise, angleDelta, smoothstep } from './CineShots.js';

const DT = 1 / 60;

function rig(): { scene: Scene; cam: GameObject; cine: CineCamera; tl: TimelineLite } {
  const scene = new Scene('Test');
  const cam = new GameObject('Cam');
  cam.transform.setPosition(0, 2, 8);
  cam.addComponent(new CameraComponent({ fov: 60 }));
  const cine = cam.addComponent(new CineCamera());
  scene.addGameObject(cam);
  const host = new GameObject('Director');
  const tl = host.addComponent(new TimelineLite({ duration: 6 }));
  scene.addGameObject(host);
  return { scene, cam, cine, tl };
}

function step(scene: Scene, frames: number): void {
  for (let i = 0; i < frames; i++) {
    for (const go of scene.gameObjects) go.update(DT);
  }
}

describe('CineShots math', () => {
  test('smoothstep eases 0..1', () => {
    assert.strictEqual(smoothstep(0), 0);
    assert.strictEqual(smoothstep(1), 1);
    assert.ok(Math.abs(smoothstep(0.5) - 0.5) < 1e-9);
  });

  test('smoothDamp converges without overshoot', () => {
    let v = 0;
    let vel = 0;
    for (let i = 0; i < 300; i++) {
      [v, vel] = smoothDamp(v, 10, vel, 0.25, DT);
      assert.ok(v <= 10 + 1e-9, `no overshoot: ${v}`);
    }
    assert.ok(Math.abs(v - 10) < 1e-3);
  });

  test('catmullRom hits endpoints and midpoints sanely', () => {
    const path: Array<[number, number, number]> = [[0, 0, 0], [5, 0, 0], [10, 2, 0]];
    assert.deepStrictEqual(catmullRomPoint(path, 0), [0, 0, 0]);
    assert.deepStrictEqual(catmullRomPoint(path, 1), [10, 2, 0]);
    const [mx] = catmullRomPoint(path, 0.5);
    assert.ok(mx > 4 && mx < 6, `mid x=${mx}`);
  });

  test('traumaNoise is bounded and deterministic', () => {
    assert.strictEqual(traumaNoise(1.23, 4), traumaNoise(1.23, 4));
    for (const t of [0, 0.7, 2.5, 9.1]) {
      assert.ok(Math.abs(traumaNoise(t, 2)) <= 1.0);
    }
    assert.strictEqual(angleDelta(0, Math.PI * 3), Math.PI);
  });
});

describe('CineCamera — cuts, blends, tracking, dolly, shake', () => {
  test('cut snaps to the shot, blend eases from the previous pose', () => {
    const { scene, cam, cine, tl } = rig();
    tl.tracks = [{
      target: 'Cam',
      clips: [
        { id: 'wide', start: 0, dur: 2, type: 'camera', data: { shot: 'wide', to: [0, 2, 8], cut: true } },
        { id: 'close', start: 2, dur: 2, type: 'camera', data: { shot: 'close', to: [0, 1, 3], blend: 1.0 } }
      ]
    }];
    step(scene, 125); // t≈2.08: close-up starts, blend from wide pose
    assert.strictEqual(cine.activeShotId, 'close');
    assert.strictEqual(cine.cutsTaken, 1);
    assert.strictEqual(cine.lastCutShot, 'wide');
    step(scene, 115); // t≈4: blend done, close-up framing reached
    const p = cam.transform.position;
    assert.ok(Math.abs(p.x) < 0.05 && Math.abs(p.y - 1) < 0.05 && Math.abs(p.z - 3) < 0.05, `at (${p.x},${p.y},${p.z})`);
  });

  test('look-target tracking converges inside the deadzone', () => {
    const { scene, cam, cine, tl } = rig();
    const actor = new GameObject('Actor');
    actor.transform.setPosition(6, 1, -2);
    scene.addGameObject(actor);
    tl.tracks = [{
      target: 'Cam',
      clips: [{ id: 'track', start: 0, dur: 4, type: 'camera', data: { shot: 'track', lookTarget: 'Actor', smoothTime: 0.2 } }]
    }];
    step(scene, 240);
    const t = cam.transform;
    const dx = 6 - t.position.x;
    const dz = -2 - t.position.z;
    const wantYaw = Math.atan2(dx, -dz);
    assert.ok(Math.abs(angleDelta(t.rotation.y, wantYaw)) < 0.05, `yaw err=${angleDelta(t.rotation.y, wantYaw)}`);
  });

  test('dolly path reaches its end pose', () => {
    const { scene, cam, cine, tl } = rig();
    tl.tracks = [{
      target: 'Cam',
      clips: [{
        id: 'sweep', start: 0, dur: 3, type: 'camera',
        data: { shot: 'sweep', dolly: { path: [[0, 2, 8], [-4, 3, 4], [0, 2, 0]], ease: 'smooth' } }
      }]
    }];
    step(scene, 200);
    const p = cam.transform.position;
    assert.ok(Math.abs(p.x) < 0.1 && Math.abs(p.y - 2) < 0.1 && Math.abs(p.z) < 0.1, `at (${p.x},${p.y},${p.z})`);
    assert.strictEqual(cine.activeShotId, 'sweep');
  });

  test('trauma shake decays to calm', () => {
    const { scene, cine, tl } = rig();
    tl.tracks = [{
      target: 'Cam',
      clips: [{ id: 'hit', start: 0, dur: 1, type: 'camera', data: { shot: 'hit', shake: { trauma: 1, decay: 0.5 } } }]
    }];
    step(scene, 30);
    assert.ok(cine.trauma > 0.3, `trauma=${cine.trauma}`);
    step(scene, 300);
    assert.ok(cine.trauma <= 0.02, `calm: ${cine.trauma}`);
  });

  test('legacy path without CineCamera still lerps', () => {
    const scene = new Scene('Legacy');
    const cam = new GameObject('Cam');
    cam.transform.setPosition(0, 0, 0);
    scene.addGameObject(cam);
    const host = new GameObject('Director');
    const tl = host.addComponent(new TimelineLite({
      duration: 2,
      tracks: [{ target: 'Cam', clips: [{ id: 'c1', start: 0, dur: 2, type: 'camera', data: { to: [4, 0, 0] } }] }]
    }));
    scene.addGameObject(host);
    step(scene, 130);
    assert.ok(Math.abs(cam.transform.position.x - 4) < 0.05);
    assert.ok(tl.finished);
  });

  test('serializes shot state', () => {
    const { cine } = rig();
    cine.addTrauma(0.5);
    const json = cine.toJSON();
    assert.strictEqual(json.type, 'CineCamera');
    const other = new CineCamera();
    other.fromJSON(JSON.parse(JSON.stringify(json)));
    assert.strictEqual(other.trauma, 0.5);
  });
});
