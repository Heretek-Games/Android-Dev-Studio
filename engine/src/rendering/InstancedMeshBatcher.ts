import * as THREE from 'three';

export interface InstanceTransform {
  position: THREE.Vector3;
  rotation?: THREE.Euler;
  scale?: THREE.Vector3;
  color?: THREE.Color;
}

/**
 * GPU Instanced Mesh Batcher.
 * Merges thousands of identical meshes (foliage, trees, props, enemies, rocks)
 * into a single GPU draw call using THREE.InstancedMesh.
 * Completely eliminates the 1:1 draw call bottleneck observed in legacy web engines.
 */
export class InstancedMeshBatcher {
  public instancedMesh: THREE.InstancedMesh;
  public geometry: THREE.BufferGeometry;
  public material: THREE.Material;
  public maxCapacity: number;
  public activeCount: number = 0;

  private tempMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private tempPosition: THREE.Vector3 = new THREE.Vector3();
  private tempQuaternion: THREE.Quaternion = new THREE.Quaternion();
  private tempScale: THREE.Vector3 = new THREE.Vector3(1, 1, 1);
  private tempColor: THREE.Color = new THREE.Color();

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    maxCapacity: number = 1000,
    castShadow: boolean = true,
    receiveShadow: boolean = true
  ) {
    this.geometry = geometry;
    this.material = material;
    this.maxCapacity = maxCapacity;

    this.instancedMesh = new THREE.InstancedMesh(geometry, material, maxCapacity);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.count = 0;
    this.instancedMesh.castShadow = castShadow;
    this.instancedMesh.receiveShadow = receiveShadow;
  }

  /**
   * Add a new instance and return its allocated instance ID
   */
  public addInstance(transform: InstanceTransform): number {
    if (this.activeCount >= this.maxCapacity) {
      console.warn(`[InstancedMeshBatcher] Max capacity (${this.maxCapacity}) reached.`);
      return -1;
    }

    const id = this.activeCount;
    this.updateInstance(id, transform);
    this.activeCount++;
    this.instancedMesh.count = this.activeCount;
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    return id;
  }

  /**
   * Update an existing instance's transform or color
   */
  public updateInstance(id: number, transform: InstanceTransform): void {
    if (id < 0 || id >= this.maxCapacity) return;

    this.tempPosition.copy(transform.position);

    if (transform.rotation) {
      this.tempQuaternion.setFromEuler(transform.rotation);
    } else {
      this.tempQuaternion.identity();
    }

    if (transform.scale) {
      this.tempScale.copy(transform.scale);
    } else {
      this.tempScale.set(1, 1, 1);
    }

    this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
    this.instancedMesh.setMatrixAt(id, this.tempMatrix);
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    if (transform.color) {
      this.instancedMesh.setColorAt(id, transform.color);
      if (this.instancedMesh.instanceColor) {
        this.instancedMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /**
   * Batch update multiple instances simultaneously for maximum performance
   */
  public setInstances(instances: InstanceTransform[]): void {
    const count = Math.min(instances.length, this.maxCapacity);
    for (let i = 0; i < count; i++) {
      const it = instances[i];
      this.tempPosition.copy(it.position);
      if (it.rotation) this.tempQuaternion.setFromEuler(it.rotation);
      else this.tempQuaternion.identity();
      if (it.scale) this.tempScale.copy(it.scale);
      else this.tempScale.set(1, 1, 1);

      this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
      this.instancedMesh.setMatrixAt(i, this.tempMatrix);

      if (it.color) {
        this.instancedMesh.setColorAt(i, it.color);
      }
    }

    this.activeCount = count;
    this.instancedMesh.count = count;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  public clear(): void {
    this.activeCount = 0;
    this.instancedMesh.count = 0;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  public destroy(): void {
    this.clear();
    if (this.instancedMesh.parent) {
      this.instancedMesh.parent.remove(this.instancedMesh);
    }
    this.geometry.dispose();
    if (Array.isArray(this.material)) {
      this.material.forEach((m) => m.dispose());
    } else {
      this.material.dispose();
    }
  }
}
