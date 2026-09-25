import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { MeshRenderer } from './MeshRenderer.js';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';

describe('MeshRenderer — primitive meshes and material control', () => {
  test('creates geometry for each primitive shape', () => {
    const shapes: Array<['box' | 'sphere' | 'cylinder' | 'capsule' | 'plane', unknown]> = [
      ['box', THREE.BoxGeometry],
      ['sphere', THREE.SphereGeometry],
      ['cylinder', THREE.CylinderGeometry],
      ['capsule', THREE.CapsuleGeometry],
      ['plane', THREE.PlaneGeometry]
    ];
    for (const [shape, ctor] of shapes) {
      const go = new GameObject(shape);
      const mr = go.addComponent(new MeshRenderer({ shape, size: [1, 1, 1] }));
      assert.ok(mr.threeMesh, `${shape} should create a mesh`);
      assert.ok(
        mr.threeMesh!.geometry instanceof (ctor as any),
        `${shape} should use ${(ctor as any).name}, got ${mr.threeMesh!.geometry.constructor.name}`
      );
    }
  });

  test('setMaterial updates color, roughness, and metalness', () => {
    const go = new GameObject('Crate');
    const mr = go.addComponent(new MeshRenderer({ shape: 'box', color: '#ff0000' }));
    mr.setMaterial('#00ff00', 0.8, 0.4);

    const material = mr.threeMesh!.material as THREE.MeshStandardMaterial;
    assert.strictEqual(`#${material.color.getHexString()}`, '#00ff00');
    assert.strictEqual(material.roughness, 0.8);
    assert.strictEqual(material.metalness, 0.4);
  });

  test('joins the scene on start and syncs world matrices on update (headless raycast ready)', () => {
    const scene = new Scene('MeshScene');
    const go = new GameObject('Target');
    go.transform.setPosition(0, 0, -5);
    const mr = go.addComponent(new MeshRenderer({ shape: 'box', size: [4, 4, 0.5] }));
    scene.addGameObject(go);

    assert.ok(mr.threeMesh!.parent === scene.threeScene, 'mesh attaches to the scene');

    go.transform.setPosition(1, 2, -5);
    mr.update(0.016);
    assert.strictEqual(mr.threeMesh!.position.x, 1);
    assert.strictEqual(mr.threeMesh!.matrixWorld.elements[12], 1, 'world matrix is current for raycasts');
  });

  test('onDestroy removes the mesh from the scene', () => {
    const scene = new Scene('MeshCleanup');
    const go = new GameObject('Temp');
    const mr = go.addComponent(new MeshRenderer({ shape: 'box' }));
    scene.addGameObject(go);
    assert.strictEqual(scene.threeScene.children.length, 1);

    mr.onDestroy();
    assert.strictEqual(scene.threeScene.children.length, 0);
  });

  test('serialization round-trips mesh options', () => {
    const mr = new MeshRenderer({ shape: 'cylinder', size: [0.5, 2, 0.5], color: '#123456', wireframe: true });
    const json = mr.toJSON();
    assert.strictEqual(json.type, 'MeshRenderer');
    assert.strictEqual(json.shape, 'cylinder');
    assert.strictEqual(json.wireframe, true);

    const host = new GameObject('Mesh2');
    const other = host.addComponent(new MeshRenderer());
    other.fromJSON(json);
    assert.strictEqual(other.shape, 'cylinder');
    assert.deepStrictEqual(other.size, [0.5, 2, 0.5]);
  });
});
