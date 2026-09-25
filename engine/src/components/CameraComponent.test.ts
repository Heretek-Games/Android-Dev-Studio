import { test, describe } from 'node:test';
import assert from 'node:assert';
import { CameraComponent } from './CameraComponent.js';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';

describe('CameraComponent — perspective camera wrapper', () => {
  test('awake creates a THREE perspective camera with configured optics', () => {
    const go = new GameObject('Cam');
    const cam = go.addComponent(new CameraComponent({ fov: 75, near: 0.5, far: 500 }));

    assert.ok(cam.threeCamera, 'camera should be created on awake');
    assert.strictEqual(cam.threeCamera!.fov, 75);
    assert.strictEqual(cam.threeCamera!.near, 0.5);
    assert.strictEqual(cam.threeCamera!.far, 500);
  });

  test('update syncs position and rotation from the transform', () => {
    const scene = new Scene('CamScene');
    const go = new GameObject('Cam');
    go.transform.setPosition(3, 4, 5);
    go.transform.setRotation(0, Math.PI / 2, 0);
    const cam = go.addComponent(new CameraComponent());
    scene.addGameObject(go);

    cam.update(0.016);
    assert.strictEqual(cam.threeCamera!.position.x, 3);
    assert.strictEqual(cam.threeCamera!.position.y, 4);
    assert.ok(Math.abs(cam.threeCamera!.rotation.y - Math.PI / 2) < 1e-6);
  });

  test('setAspect and lookAt update the camera', () => {
    const go = new GameObject('Cam');
    const cam = go.addComponent(new CameraComponent());
    cam.setAspect(16 / 9);
    assert.ok(Math.abs(cam.threeCamera!.aspect - 16 / 9) < 1e-6);

    cam.lookAt(0, 0, -10);
    // Camera at origin looking down -Z has identity rotation
    assert.ok(Math.abs(cam.threeCamera!.rotation.x) < 1e-6);
    assert.ok(Math.abs(cam.threeCamera!.rotation.y) < 1e-6);
  });

  test('serialization round-trips camera options', () => {
    const cam = new CameraComponent({ fov: 90, isMain: false });
    const json = cam.toJSON();
    assert.strictEqual(json.type, 'CameraComponent');
    assert.strictEqual(json.fov, 90);
    assert.strictEqual(json.isMain, false);

    const host = new GameObject('Cam2');
    const other = host.addComponent(new CameraComponent());
    other.fromJSON(json);
    assert.strictEqual(other.fov, 90);
    assert.strictEqual(other.isMain, false);
  });
});
