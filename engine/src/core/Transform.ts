import * as THREE from 'three';

export class Transform {
  public position: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public rotation: THREE.Euler = new THREE.Euler(0, 0, 0, 'YXZ');
  public scale: THREE.Vector3 = new THREE.Vector3(1, 1, 1);
  public quaternion: THREE.Quaternion = new THREE.Quaternion();

  public parent: Transform | null = null;
  public children: Transform[] = [];

  public localMatrix: THREE.Matrix4 = new THREE.Matrix4();
  public worldMatrix: THREE.Matrix4 = new THREE.Matrix4();

  constructor(x = 0, y = 0, z = 0) {
    this.position.set(x, y, z);
    this.updateMatrices();
  }

  public addChild(child: Transform): void {
    if (child.parent === this) return;
    if (child.parent) {
      child.parent.removeChild(child);
    }
    child.parent = this;
    this.children.push(child);
    child.updateMatrices();
  }

  public removeChild(child: Transform): void {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parent = null;
      child.updateMatrices();
    }
  }

  public setPosition(x: number, y: number, z: number): this {
    this.position.set(x, y, z);
    this.updateMatrices();
    return this;
  }

  public setRotation(x: number, y: number, z: number): this {
    this.rotation.set(x, y, z, 'YXZ');
    this.quaternion.setFromEuler(this.rotation);
    this.updateMatrices();
    return this;
  }

  public setScale(x: number, y: number, z: number): this {
    this.scale.set(x, y, z);
    this.updateMatrices();
    return this;
  }

  public translate(dx: number, dy: number, dz: number): this {
    this.position.x += dx;
    this.position.y += dy;
    this.position.z += dz;
    this.updateMatrices();
    return this;
  }

  public rotateY(rad: number): this {
    this.rotation.y += rad;
    this.quaternion.setFromEuler(this.rotation);
    this.updateMatrices();
    return this;
  }

  public updateMatrices(): void {
    this.quaternion.setFromEuler(this.rotation);
    this.localMatrix.compose(this.position, this.quaternion, this.scale);

    if (this.parent) {
      this.worldMatrix.multiplyMatrices(this.parent.worldMatrix, this.localMatrix);
    } else {
      this.worldMatrix.copy(this.localMatrix);
    }

    for (const child of this.children) {
      child.updateMatrices();
    }
  }

  public getWorldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    this.worldMatrix.decompose(out, new THREE.Quaternion(), new THREE.Vector3());
    return out;
  }

  public toJSON(): { position: number[]; rotation: number[]; scale: number[] } {
    return {
      position: [this.position.x, this.position.y, this.position.z],
      rotation: [this.rotation.x, this.rotation.y, this.rotation.z],
      scale: [this.scale.x, this.scale.y, this.scale.z]
    };
  }

  public fromJSON(data: { position?: number[]; rotation?: number[]; scale?: number[] }): void {
    if (data.position && data.position.length >= 3) {
      this.position.set(data.position[0], data.position[1], data.position[2]);
    }
    if (data.rotation && data.rotation.length >= 3) {
      this.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2], 'YXZ');
      this.quaternion.setFromEuler(this.rotation);
    }
    if (data.scale && data.scale.length >= 3) {
      this.scale.set(data.scale[0], data.scale[1], data.scale[2]);
    }
    this.updateMatrices();
  }
}
