import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Scene } from './Scene.js';
import { GameObject } from './GameObject.js';
import { MeshRenderer } from '../components/MeshRenderer.js';
import { CameraComponent } from '../components/CameraComponent.js';
import { LightComponent } from '../components/LightComponent.js';
import { EventSheet } from '../events/EventSheet.js';
import { EngineContext } from './EngineContext.js';
import { BlendTree1D, AnimationController } from '../animation/BlendTree.js';
import {
  BehaviorTreeComponent,
  DistanceCheckNode,
  MoveTowardsNode,
  SequenceNode,
  SelectorNode,
  BTStatus
} from '../ai/BehaviorTree.js';
import { WeaponController } from '../weapons/WeaponController.js';
import { CelShadingComponent } from '../shaders/CelShader.js';
import { InstancedMeshBatcher } from '../rendering/InstancedMeshBatcher.js';
import { TerrainChunk } from '../terrain/TerrainChunk.js';
import { ModelRenderer } from '../components/ModelRenderer.js';
import { AnimeCelShader } from '../shaders/AnimeCelShader.js';
import * as THREE from 'three';

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

  test('animation blend tree interpolates locomotion clips', () => {
    const bt = new BlendTree1D('speed', [
      { name: 'Idle', duration: 2.0, threshold: 0.0 },
      { name: 'Walk', duration: 1.0, threshold: 4.0 },
      { name: 'Run', duration: 0.6, threshold: 8.0 }
    ]);

    // Test exact lower bound
    const idleRes = bt.evaluate(0.0, 0.1);
    assert.strictEqual(idleRes.primaryClip, 'Idle');
    assert.strictEqual(idleRes.blendWeight, 0);

    // Test intermediate interpolation (speed = 6.0 is 50% between Walk and Run)
    const midRes = bt.evaluate(6.0, 0.1);
    assert.strictEqual(midRes.primaryClip, 'Walk');
    assert.strictEqual(midRes.secondaryClip, 'Run');
    assert.strictEqual(midRes.blendWeight, 0.5);
  });

  test('behavior tree evaluates selector and distance conditions', () => {
    const scene = new Scene('AIScene');
    const player = new GameObject('Player Hero');
    player.transform.setPosition(0, 0, 0);
    scene.addGameObject(player);

    const demon = new GameObject('Demon');
    demon.transform.setPosition(0, 0, 5); // 5m away
    const bt = demon.addComponent(new BehaviorTreeComponent(
      new SequenceNode([
        new DistanceCheckNode('Player Hero', 10.0, 'less'),
        new MoveTowardsNode('Player Hero', 2.0, 1.0)
      ])
    ));
    scene.addGameObject(demon);

    demon.update(1.0); // Demon moves 2m towards player along -Z
    assert.strictEqual(bt.lastStatus, BTStatus.RUNNING);
    assert.ok(demon.transform.position.z < 5.0);
  });

  test('weapon controller fires, tracks ammo, and reloads', () => {
    const weapon = new WeaponController({ maxAmmo: 10, fireRate: 10, reloadTime: 0.5 });
    assert.strictEqual(weapon.currentAmmo, 10);

    const hit = weapon.fire();
    assert.strictEqual(weapon.currentAmmo, 9);
    assert.strictEqual(weapon.canFire(), false); // In cooldown

    // Empty magazine
    weapon.currentAmmo = 0;
    weapon.fire(); // Triggers reload
    assert.strictEqual(weapon.isReloading, true);

    weapon.update(0.6); // Completes reload
    assert.strictEqual(weapon.isReloading, false);
    assert.strictEqual(weapon.currentAmmo, 10);
  });

  test('cel shading component serializes parameters', () => {
    const cel = new CelShadingComponent({ steps: 4, rimColor: '#38bdf8', outlineWidth: 0.05 });
    const json = cel.toJSON();
    assert.strictEqual(json.steps, 4);
    assert.strictEqual(json.rimColor, '#38bdf8');
    assert.strictEqual(json.outlineWidth, 0.05);
  });

  test('instanced mesh batcher adds instances and batches draw calls', () => {
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const batcher = new InstancedMeshBatcher(geom, mat, 50);

    const id0 = batcher.addInstance({
      position: new THREE.Vector3(0, 0, 0),
      color: new THREE.Color('#3b82f6')
    });
    const id1 = batcher.addInstance({
      position: new THREE.Vector3(5, 0, 5),
      color: new THREE.Color('#ef4444')
    });

    assert.strictEqual(id0, 0);
    assert.strictEqual(id1, 1);
    assert.strictEqual(batcher.activeCount, 2);
    assert.strictEqual(batcher.instancedMesh.count, 2);

    batcher.destroy();
    assert.strictEqual(batcher.activeCount, 0);
  });

  test('terrain chunk generates heightmap and samples elevation', () => {
    const chunk = new TerrainChunk({
      chunkX: 0,
      chunkZ: 0,
      size: 32,
      resolution: 16,
      maxHeight: 10,
      seed: 42
    });

    const hCenter = chunk.sampleHeight(16, 16);
    assert.ok(typeof hCenter === 'number');
    assert.ok(hCenter >= 0 && hCenter <= 10);

    const go = new GameObject('Terrain');
    go.addComponent(chunk);
    assert.ok(chunk.mesh !== null);
    assert.strictEqual(chunk.geometry?.attributes.position.count, 16 * 16);
    go.destroy();
  });

  test('model renderer serializes options and tracks animation state', () => {
    const mr = new ModelRenderer({
      modelUrl: 'https://example.com/hero.glb',
      defaultAnimation: 'Run',
      scale: [1.5, 1.5, 1.5]
    });

    const json = mr.toJSON();
    assert.strictEqual(json.type, 'ModelRenderer');
    assert.strictEqual(json.modelUrl, 'https://example.com/hero.glb');
    assert.strictEqual(json.defaultAnimation, 'Run');
    assert.deepStrictEqual(json.scale, [1.5, 1.5, 1.5]);
  });

  test('anime cel shader initializes lighting and outline parameters', () => {
    const shader = new AnimeCelShader({
      baseColor: '#38bdf8',
      shadowColor: '#1e3a8a',
      outlineThickness: 0.04
    });

    assert.strictEqual(shader.outlineThickness, 0.04);
    assert.ok(shader.baseColor instanceof THREE.Color);
  });
});
