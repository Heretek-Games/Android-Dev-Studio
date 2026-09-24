import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from './Scene.js';
import { GameObject } from './GameObject.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { CameraComponent } from '../components/CameraComponent.js';
import { LightComponent } from '../components/LightComponent.js';
import { EventSheet } from '../events/EventSheet.js';
import { EngineContext } from './EngineContext.js';

describe('Engine Core ECS & Scene Graph', () => {
  test('creates game objects and adds components', () => {
    const scene = new Scene('TestScene');
    const player = new GameObject('Player');
    
    player.transform.setPosition(0, 1.5, 0);
    player.addComponent(new MeshRenderer({ shape: 'sphere', color: '#ff0000' }));
    player.addComponent(new CameraComponent({ fov: 75 }));
    
    scene.addGameObject(player);

    assert.strictEqual(scene.gameObjects.length, 1);
    assert.strictEqual(scene.findByName('Player'), player);
    assert.strictEqual(player.transform.position.y, 1.5);
    
    const renderer = player.getComponent(MeshRenderer);
    assert.ok(renderer);
    assert.strictEqual(renderer.shape, 'sphere');
  });

  test('transform hierarchy matrix propagation', () => {
    const parent = new GameObject('Parent');
    const child = new GameObject('Child');

    parent.transform.setPosition(10, 0, 0);
    parent.transform.addChild(child.transform);
    child.transform.setPosition(5, 2, 0);

    const worldPos = child.transform.getWorldPosition();
    assert.strictEqual(worldPos.x, 15);
    assert.strictEqual(worldPos.y, 2);
    assert.strictEqual(worldPos.z, 0);
  });

  test('engine context ticks scene and updates event sheet', () => {
    const scene = new Scene('TickScene');
    const rotator = new GameObject('Rotator');

    rotator.addComponent(new EventSheet([
      {
        id: 'rot_event',
        name: 'Continuous Rotation',
        enabled: true,
        conditions: [{ type: 'EveryFrame' }],
        actions: [{ type: 'RotateY', params: { speed: 2.0 } }]
      }
    ]));

    scene.addGameObject(rotator);
    const ctx = new EngineContext();
    ctx.setScene(scene);

    assert.strictEqual(rotator.transform.rotation.y, 0);
    ctx.step(0.5); // 0.5s * 2.0 rad/s = 1.0 rad
    assert.strictEqual(rotator.transform.rotation.y, 1.0);
  });

  test('scene serialization and deserialization', () => {
    const scene = new Scene('SaveScene');
    const light = new GameObject('Sun');
    light.addComponent(new LightComponent({ type: 'directional', intensity: 2.0 }));
    scene.addGameObject(light);

    const json = scene.toJSON();
    assert.strictEqual(json.name, 'SaveScene');
    assert.strictEqual(json.gameObjects.length, 1);
    assert.strictEqual(json.gameObjects[0].name, 'Sun');
  });

  test('event sheet translates and scales object', () => {
    const scene = new Scene('ActionScene');
    const mover = new GameObject('Mover');
    mover.transform.setPosition(0, 0, 0);

    mover.addComponent(new EventSheet([
      {
        id: 'move_event',
        name: 'Translate and Scale',
        enabled: true,
        conditions: [{ type: 'EveryFrame' }],
        actions: [
          { type: 'Translate', params: { x: 2, y: 0, z: 4, relativeToDelta: true } },
          { type: 'SetScale', params: { x: 2, y: 3, z: 2 } }
        ]
      }
    ]));

    scene.addGameObject(mover);
    const ctx = new EngineContext();
    ctx.setScene(scene);

    ctx.step(0.5); // x: 2 * 0.5 = 1, z: 4 * 0.5 = 2
    assert.strictEqual(mover.transform.position.x, 1);
    assert.strictEqual(mover.transform.position.z, 2);
    assert.strictEqual(mover.transform.scale.x, 2);
    assert.strictEqual(mover.transform.scale.y, 3);
  });
});
