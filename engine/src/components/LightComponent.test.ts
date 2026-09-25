import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { LightComponent } from './LightComponent.js';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';

describe('LightComponent — light types and lifecycle', () => {
  test('creates the matching THREE light for each light type', () => {
    const types: Array<['directional' | 'point' | 'ambient', unknown]> = [
      ['directional', THREE.DirectionalLight],
      ['point', THREE.PointLight],
      ['ambient', THREE.AmbientLight]
    ];
    for (const [type, ctor] of types) {
      const go = new GameObject(`${type} light`);
      const light = go.addComponent(new LightComponent({ type, intensity: 2 }));
      assert.ok(light.threeLight instanceof (ctor as any), `${type} should create ${(ctor as any).name}`);
    }
  });

  test('applies color and intensity, and joins the scene on start', () => {
    const scene = new Scene('LightScene');
    const go = new GameObject('Sun');
    const light = go.addComponent(new LightComponent({ type: 'directional', color: '#ff8800', intensity: 3 }));
    scene.addGameObject(go);

    assert.ok(light.threeLight);
    assert.strictEqual(light.threeLight!.intensity, 3);
    assert.ok(light.threeLight!.parent === scene.threeScene, 'light should attach to the scene');
  });

  test('update syncs position from the transform', () => {
    const go = new GameObject('Lamp');
    go.transform.setPosition(2, 6, -3);
    const light = go.addComponent(new LightComponent({ type: 'point' }));
    light.update(0.016);

    assert.strictEqual(light.threeLight!.position.x, 2);
    assert.strictEqual(light.threeLight!.position.y, 6);
    assert.strictEqual(light.threeLight!.position.z, -3);
  });

  test('onDestroy detaches the light from the scene', () => {
    const scene = new Scene('LightCleanup');
    const go = new GameObject('Lamp');
    const light = go.addComponent(new LightComponent({ type: 'point' }));
    scene.addGameObject(go);
    assert.strictEqual(scene.threeScene.children.length, 1);

    light.onDestroy();
    assert.strictEqual(scene.threeScene.children.length, 0);
  });

  test('serialization round-trips light parameters', () => {
    const light = new LightComponent({ type: 'point', color: '#00ff00', intensity: 1.5, distance: 12, castShadow: false });
    const json = light.toJSON();
    assert.strictEqual(json.type, 'LightComponent');
    assert.strictEqual(json.lightType, 'point');
    assert.strictEqual(json.distance, 12);
    assert.strictEqual(json.castShadow, false);

    const host = new GameObject('Lamp2');
    const other = host.addComponent(new LightComponent());
    other.fromJSON(json);
    assert.strictEqual(other.intensity, 1.5);
    assert.strictEqual(other.lightType, 'point');
  });
});
