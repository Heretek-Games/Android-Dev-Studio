import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { InstancedMeshBatcher } from './InstancedMeshBatcher.js';

function buildBatcher(capacity = 10) {
  return new InstancedMeshBatcher(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), capacity);
}

describe('InstancedMeshBatcher — single-draw-call mass rendering', () => {
  test('adds instances up to capacity and tracks the active count', () => {
    const batcher = buildBatcher(3);
    const id0 = batcher.addInstance({ position: new THREE.Vector3(0, 0, 0), color: new THREE.Color('#fff') });
    const id1 = batcher.addInstance({ position: new THREE.Vector3(1, 0, 0), color: new THREE.Color('#fff') });

    assert.strictEqual(id0, 0);
    assert.strictEqual(id1, 1);
    assert.strictEqual(batcher.activeCount, 2);
    assert.strictEqual(batcher.instancedMesh.count, 2, 'one instanced draw covers all instances');

    batcher.addInstance({ position: new THREE.Vector3(2, 0, 0), color: new THREE.Color('#fff') });
    assert.strictEqual(batcher.addInstance({ position: new THREE.Vector3(3, 0, 0), color: new THREE.Color('#fff') }), -1, 'capacity overflow returns -1');
    assert.strictEqual(batcher.activeCount, 3);
  });

  test('updateInstance writes new transforms into the instance matrix', () => {
    const batcher = buildBatcher();
    const id = batcher.addInstance({ position: new THREE.Vector3(0, 0, 0), color: new THREE.Color('#fff') });
    batcher.updateInstance(id, { position: new THREE.Vector3(7, 0, -2), color: new THREE.Color('#f00') });

    const matrix = new THREE.Matrix4();
    batcher.instancedMesh.getMatrixAt(id, matrix);
    const position = new THREE.Vector3().setFromMatrixPosition(matrix);
    assert.ok(Math.abs(position.x - 7) < 1e-6);
    assert.ok(Math.abs(position.z - -2) < 1e-6);
  });

  test('setInstances replaces the whole batch', () => {
    const batcher = buildBatcher(5);
    batcher.addInstance({ position: new THREE.Vector3(), color: new THREE.Color('#fff') });

    batcher.setInstances([
      { position: new THREE.Vector3(1, 0, 0), color: new THREE.Color('#0f0') },
      { position: new THREE.Vector3(2, 0, 0), color: new THREE.Color('#0f0') },
      { position: new THREE.Vector3(3, 0, 0), color: new THREE.Color('#0f0') }
    ]);
    assert.strictEqual(batcher.activeCount, 3);
    assert.strictEqual(batcher.instancedMesh.count, 3);
  });

  test('clear and destroy reset state', () => {
    const batcher = buildBatcher();
    batcher.addInstance({ position: new THREE.Vector3(), color: new THREE.Color('#fff') });
    batcher.clear();
    assert.strictEqual(batcher.activeCount, 0);
    assert.strictEqual(batcher.instancedMesh.count, 0);

    batcher.addInstance({ position: new THREE.Vector3(), color: new THREE.Color('#fff') });
    batcher.destroy();
    assert.strictEqual(batcher.activeCount, 0);
  });
});
