import * as THREE from 'three';
import { Component } from '../core/Component.js';

export interface CameraComponentOptions {
  fov?: number;
  near?: number;
  far?: number;
  isMain?: boolean;
}

export class CameraComponent extends Component {
  public fov: number = 60;
  public near: number = 0.1;
  public far: number = 1000;
  public isMain: boolean = true;

  public threeCamera: THREE.PerspectiveCamera | null = null;

  constructor(options?: CameraComponentOptions) {
    super();
    if (options) {
      if (options.fov !== undefined) this.fov = options.fov;
      if (options.near !== undefined) this.near = options.near;
      if (options.far !== undefined) this.far = options.far;
      if (options.isMain !== undefined) this.isMain = options.isMain;
    }
  }

  public override awake(): void {
    this.createCamera();
  }

  public override update(_deltaTime: number): void {
    if (!this.threeCamera) return;
    const t = this.gameObject.transform;
    this.threeCamera.position.copy(t.position);
    this.threeCamera.quaternion.copy(t.quaternion);
  }

  public setAspect(aspect: number): void {
    if (this.threeCamera) {
      this.threeCamera.aspect = aspect;
      this.threeCamera.updateProjectionMatrix();
    }
  }

  public lookAt(x: number, y: number, z: number): void {
    if (this.threeCamera) {
      this.threeCamera.lookAt(x, y, z);
      this.gameObject.transform.quaternion.copy(this.threeCamera.quaternion);
      this.gameObject.transform.rotation.setFromQuaternion(this.threeCamera.quaternion, 'YXZ');
    }
  }

  private createCamera(): void {
    const aspect = typeof window !== 'undefined' ? window.innerWidth / window.innerHeight : 16 / 9;
    this.threeCamera = new THREE.PerspectiveCamera(this.fov, aspect, this.near, this.far);

    const t = this.gameObject.transform;
    this.threeCamera.position.copy(t.position);
    this.threeCamera.quaternion.copy(t.quaternion);
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'CameraComponent',
      enabled: this.enabled,
      fov: this.fov,
      near: this.near,
      far: this.far,
      isMain: this.isMain
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.fov !== undefined) this.fov = data.fov;
    if (data.near !== undefined) this.near = data.near;
    if (data.far !== undefined) this.far = data.far;
    if (data.isMain !== undefined) this.isMain = data.isMain;
    this.createCamera();
  }
}
