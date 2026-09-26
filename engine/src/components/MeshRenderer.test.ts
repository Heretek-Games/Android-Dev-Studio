import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { MeshRenderer, normalizePbrMaterial, validatePbrMaterial } from './MeshRenderer.js';
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

describe('PbrMaterial — glTF-shaped factors (Track C.3)', () => {
  test('normalize clamps and defaults partial payloads', () => {
    const mat = normalizePbrMaterial({ metallic: 2, roughness: -1, shading: 'unlit' });
    assert.deepStrictEqual(mat, {
      baseColor: [1, 1, 1], metallic: 1, roughness: 0,
      emissive: [0, 0, 0], shading: 'unlit'
    });
    assert.deepStrictEqual(normalizePbrMaterial(null).shading, 'pbr');
    assert.deepStrictEqual(
      normalizePbrMaterial({ shading: 'cel' as unknown as 'pbr' }).shading, 'pbr');
  });

  test('validate reports problems, empty means valid', () => {
    assert.deepStrictEqual(validatePbrMaterial({
      baseColor: [1, 0.5, 0], metallic: 0.2, roughness: 0.8,
      emissive: [0, 0, 0], shading: 'pbr'
    }), []);
    const problems = validatePbrMaterial({
      baseColor: [2, 0, 0], metallic: -1, roughness: NaN,
      shading: 'cel', emissive: 'red'
    });
    assert.ok(problems.length >= 4, problems.join('; '));
    assert.deepStrictEqual(validatePbrMaterial(null), ['material must be an object']);
  });

  test('get/setPbrMaterial round-trips through hex color', () => {
    const go = new GameObject('Pbr');
    const mr = go.addComponent(new MeshRenderer({ color: '#3b82f6', roughness: 0.4, metalness: 0.2 }));
    const mat = mr.getPbrMaterial();
    assert.strictEqual(mat.metallic, 0.2);
    assert.strictEqual(mat.roughness, 0.4);
    assert.strictEqual(mat.shading, 'pbr');
    assert.deepStrictEqual(mr.setPbrMaterial({ metallic: 0.9, roughness: 0.1 }), []);
    assert.strictEqual(mr.metalness, 0.9);
    assert.strictEqual(mr.roughness, 0.1);
    assert.deepStrictEqual(
      mr.setPbrMaterial({ metallic: 5 }), ['metallic must be 0..1']);
    assert.strictEqual(mr.metalness, 0.9);
  });
});
