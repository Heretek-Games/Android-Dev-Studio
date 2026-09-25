import * as THREE from 'three';
import { Component } from '../core/Component.js';

export type PrimitiveShape = 'box' | 'sphere' | 'cylinder' | 'capsule' | 'plane' | 'torus';

export interface MeshRendererOptions {
  shape?: PrimitiveShape;
  color?: string | number;
  roughness?: number;
  metalness?: number;
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  size?: [number, number, number];
}

export class MeshRenderer extends Component {
  public shape: PrimitiveShape = 'box';
  public color: string = '#3b82f6';
  public roughness: number = 0.5;
  public metalness: number = 0.1;
  public wireframe: boolean = false;
  public castShadow: boolean = true;
  public receiveShadow: boolean = true;
  public size: [number, number, number] = [1, 1, 1];

  public threeMesh: THREE.Mesh | null = null;

  constructor(options?: MeshRendererOptions) {
    super();
    if (options) {
      if (options.shape) this.shape = options.shape;
      if (options.color !== undefined) this.color = options.color.toString();
      if (options.roughness !== undefined) this.roughness = options.roughness;
      if (options.metalness !== undefined) this.metalness = options.metalness;
      if (options.wireframe !== undefined) this.wireframe = options.wireframe;
      if (options.castShadow !== undefined) this.castShadow = options.castShadow;
      if (options.receiveShadow !== undefined) this.receiveShadow = options.receiveShadow;
      if (options.size) this.size = options.size;
    }
  }

  public override awake(): void {
    this.createMesh();
  }

  public override start(): void {
    if (this.threeMesh && this.gameObject.scene?.threeScene) {
      if (!this.threeMesh.parent) {
        this.gameObject.scene.threeScene.add(this.threeMesh);
      }
    }
  }

  public override update(_deltaTime: number): void {
    this.syncMeshTransform();
  }

  public override lateUpdate(_deltaTime: number): void {
    this.syncMeshTransform();
  }

  private syncMeshTransform(): void {
    if (!this.threeMesh) return;
    const t = this.gameObject.transform;
    if (t.parent) {
      t.updateMatrices();
      this.threeMesh.position.setFromMatrixPosition(t.worldMatrix);
      this.threeMesh.quaternion.setFromRotationMatrix(t.worldMatrix);
      this.threeMesh.scale.setFromMatrixScale(t.worldMatrix);
    } else {
      this.threeMesh.position.copy(t.position);
      this.threeMesh.rotation.copy(t.rotation);
      this.threeMesh.scale.copy(t.scale);
    }
    // Keep world matrices current so raycasts (weapons, queries) are correct
    // even without an active render loop (headless QA, tests).
    this.threeMesh.updateMatrixWorld();
  }

  public override onDestroy(): void {
    if (this.threeMesh) {
      if (this.threeMesh.parent) {
        this.threeMesh.parent.remove(this.threeMesh);
      }
      this.threeMesh.geometry.dispose();
      if (Array.isArray(this.threeMesh.material)) {
        this.threeMesh.material.forEach(m => m.dispose());
      } else {
        this.threeMesh.material.dispose();
      }
      this.threeMesh = null;
    }
  }

  public setMaterial(color?: string, roughness?: number, metalness?: number): void {
    if (color !== undefined) this.color = color;
    if (roughness !== undefined) this.roughness = roughness;
    if (metalness !== undefined) this.metalness = metalness;

    if (this.threeMesh && this.threeMesh.material instanceof THREE.MeshStandardMaterial) {
      this.threeMesh.material.color.set(this.color);
      this.threeMesh.material.roughness = this.roughness;
      this.threeMesh.material.metalness = this.metalness;
    }
  }

  private createGeometry(): THREE.BufferGeometry {
    const [sx, sy, sz] = this.size;
    switch (this.shape) {
      case 'sphere':
        return new THREE.SphereGeometry(sx / 2, 32, 24);
      case 'cylinder':
        return new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 32);
      case 'capsule':
        return new THREE.CapsuleGeometry(sx / 2, sy / 2, 16, 32);
      case 'plane':
        return new THREE.PlaneGeometry(sx, sz);
      case 'torus':
        return new THREE.TorusGeometry(sx / 2, sz / 4, 16, 32);
      case 'box':
      default:
        return new THREE.BoxGeometry(sx, sy, sz);
    }
  }

  private createMesh(): void {
    if (this.threeMesh) {
      this.onDestroy();
    }

    const geometry = this.createGeometry();
    const material = new THREE.MeshStandardMaterial({
      color: this.color,
      roughness: this.roughness,
      metalness: this.metalness,
      wireframe: this.wireframe
    });

    this.threeMesh = new THREE.Mesh(geometry, material);
    this.threeMesh.name = this.gameObject.name;
    this.threeMesh.castShadow = this.castShadow;
    this.threeMesh.receiveShadow = this.receiveShadow;
    this.threeMesh.userData.gameObject = this.gameObject;

    const t = this.gameObject.transform;
    this.threeMesh.position.copy(t.position);
    this.threeMesh.rotation.copy(t.rotation);
    this.threeMesh.scale.copy(t.scale);

    if (this.gameObject.scene?.threeScene) {
      this.gameObject.scene.threeScene.add(this.threeMesh);
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'MeshRenderer',
      enabled: this.enabled,
      shape: this.shape,
      color: this.color,
      roughness: this.roughness,
      metalness: this.metalness,
      wireframe: this.wireframe,
      castShadow: this.castShadow,
      receiveShadow: this.receiveShadow,
      size: this.size
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.shape) this.shape = data.shape;
    if (data.color) this.color = data.color;
    if (data.roughness !== undefined) this.roughness = data.roughness;
    if (data.metalness !== undefined) this.metalness = data.metalness;
    if (data.wireframe !== undefined) this.wireframe = data.wireframe;
    if (data.castShadow !== undefined) this.castShadow = data.castShadow;
    if (data.receiveShadow !== undefined) this.receiveShadow = data.receiveShadow;
    if (data.size) this.size = data.size;
    this.createMesh();
  }
}
