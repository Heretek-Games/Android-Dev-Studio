import RAPIER from '@dimforge/rapier3d-compat';
import { Component } from '../core/Component.js';
import { RigidBody3D } from './RigidBody3D.js';
import type { PhysicsWorld } from '../physics/PhysicsWorld.js';

export type ColliderShape = 'box' | 'sphere' | 'capsule' | 'cylinder';

export interface ColliderOptions {
  shape?: ColliderShape;
  size?: [number, number, number];
  isTrigger?: boolean;
  friction?: number;
  restitution?: number;
}

export class Collider3D extends Component {
  public shape: ColliderShape = 'box';
  public size: [number, number, number] = [1, 1, 1];
  public isTrigger: boolean = false;
  public friction: number = 0.5;
  public restitution: number = 0.0;

  public rapierCollider: RAPIER.Collider | null = null;
  private physicsWorld: PhysicsWorld | null = null;

  constructor(options?: ColliderOptions) {
    super();
    if (options) {
      if (options.shape) this.shape = options.shape;
      if (options.size) this.size = options.size;
      if (options.isTrigger !== undefined) this.isTrigger = options.isTrigger;
      if (options.friction !== undefined) this.friction = options.friction;
      if (options.restitution !== undefined) this.restitution = options.restitution;
    }
  }

  public initPhysics(physics: PhysicsWorld): void {
    if (!physics.world || this.rapierCollider) return;
    this.physicsWorld = physics;

    const [sx, sy, sz] = this.size;
    let colliderDesc: RAPIER.ColliderDesc;

    switch (this.shape) {
      case 'sphere':
        colliderDesc = RAPIER.ColliderDesc.ball(sx / 2);
        break;
      case 'capsule':
        colliderDesc = RAPIER.ColliderDesc.capsule(sy / 2, sx / 2);
        break;
      case 'cylinder':
        colliderDesc = RAPIER.ColliderDesc.cylinder(sy / 2, sx / 2);
        break;
      case 'box':
      default:
        colliderDesc = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2);
        break;
    }

    colliderDesc.setSensor(this.isTrigger);
    colliderDesc.setFriction(this.friction);
    colliderDesc.setRestitution(this.restitution);

    const rb = this.gameObject.getComponent(RigidBody3D);
    if (rb && rb.rapierBody) {
      this.rapierCollider = physics.world.createCollider(colliderDesc, rb.rapierBody);
    } else {
      const t = this.gameObject.transform;
      colliderDesc.setTranslation(t.position.x, t.position.y, t.position.z);
      colliderDesc.setRotation({
        x: t.quaternion.x,
        y: t.quaternion.y,
        z: t.quaternion.z,
        w: t.quaternion.w
      });
      this.rapierCollider = physics.world.createCollider(colliderDesc);
    }
    (this.rapierCollider as any).userData = this.gameObject;
  }

  public override onDestroy(): void {
    if (this.rapierCollider && this.physicsWorld?.world) {
      this.physicsWorld.world.removeCollider(this.rapierCollider, true);
      this.rapierCollider = null;
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'Collider3D',
      enabled: this.enabled,
      shape: this.shape,
      size: this.size,
      isTrigger: this.isTrigger,
      friction: this.friction,
      restitution: this.restitution
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.shape) this.shape = data.shape;
    if (data.size) this.size = data.size;
    if (data.isTrigger !== undefined) this.isTrigger = data.isTrigger;
    if (data.friction !== undefined) this.friction = data.friction;
    if (data.restitution !== undefined) this.restitution = data.restitution;
  }
}
