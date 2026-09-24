import RAPIER from '@dimforge/rapier3d-compat';
import { Component } from '../core/Component.js';
import type { PhysicsWorld } from '../physics/PhysicsWorld.js';

export type BodyType = 'dynamic' | 'fixed' | 'kinematic';

export interface RigidBodyOptions {
  type?: BodyType;
  bodyType?: BodyType;
  mass?: number;
  linearDamping?: number;
  angularDamping?: number;
  gravityScale?: number;
}

export class RigidBody3D extends Component {
  public bodyType: BodyType = 'dynamic';
  public mass: number = 1.0;
  public linearDamping: number = 0.0;
  public angularDamping: number = 0.0;
  public gravityScale: number = 1.0;

  public rapierBody: RAPIER.RigidBody | null = null;
  private physicsWorld: PhysicsWorld | null = null;

  constructor(options?: RigidBodyOptions) {
    super();
    if (options) {
      if (options.bodyType) this.bodyType = options.bodyType;
      else if (options.type) this.bodyType = options.type;
      if (options.mass !== undefined) this.mass = options.mass;
      if (options.linearDamping !== undefined) this.linearDamping = options.linearDamping;
      if (options.angularDamping !== undefined) this.angularDamping = options.angularDamping;
      if (options.gravityScale !== undefined) this.gravityScale = options.gravityScale;
    }
  }

  public initPhysics(physics: PhysicsWorld): void {
    if (!physics.world || this.rapierBody) return;
    this.physicsWorld = physics;

    const t = this.gameObject.transform;
    let bodyDesc: RAPIER.RigidBodyDesc;

    switch (this.bodyType) {
      case 'fixed':
        bodyDesc = RAPIER.RigidBodyDesc.fixed();
        break;
      case 'kinematic':
        bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
        break;
      case 'dynamic':
      default:
        bodyDesc = RAPIER.RigidBodyDesc.dynamic();
        break;
    }

    bodyDesc.setTranslation(t.position.x, t.position.y, t.position.z);
    bodyDesc.setRotation({
      x: t.quaternion.x,
      y: t.quaternion.y,
      z: t.quaternion.z,
      w: t.quaternion.w
    });
    bodyDesc.setLinearDamping(this.linearDamping);
    bodyDesc.setAngularDamping(this.angularDamping);
    bodyDesc.setGravityScale(this.gravityScale);

    this.rapierBody = physics.world.createRigidBody(bodyDesc);
    this.rapierBody.userData = this.gameObject;
  }

  public override update(_deltaTime: number): void {
    if (!this.rapierBody || this.bodyType === 'fixed') return;

    const pos = this.rapierBody.translation();
    const rot = this.rapierBody.rotation();

    const t = this.gameObject.transform;
    t.position.set(pos.x, pos.y, pos.z);
    t.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    t.rotation.setFromQuaternion(t.quaternion, 'YXZ');
    t.updateMatrices();
  }

  public applyImpulse(x: number, y: number, z: number): void {
    if (this.rapierBody && this.bodyType === 'dynamic') {
      this.rapierBody.applyImpulse({ x, y, z }, true);
    }
  }

  public applyForce(x: number, y: number, z: number): void {
    if (this.rapierBody && this.bodyType === 'dynamic') {
      this.rapierBody.addForce({ x, y, z }, true);
    }
  }

  public setLinearVelocity(x: number, y: number, z: number): void {
    if (this.rapierBody && this.bodyType === 'dynamic') {
      this.rapierBody.setLinvel({ x, y, z }, true);
    }
  }

  public override onDestroy(): void {
    if (this.rapierBody && this.physicsWorld?.world) {
      this.physicsWorld.world.removeRigidBody(this.rapierBody);
      this.rapierBody = null;
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'RigidBody3D',
      enabled: this.enabled,
      bodyType: this.bodyType,
      mass: this.mass,
      linearDamping: this.linearDamping,
      angularDamping: this.angularDamping,
      gravityScale: this.gravityScale
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.bodyType) this.bodyType = data.bodyType;
    if (data.mass !== undefined) this.mass = data.mass;
    if (data.linearDamping !== undefined) this.linearDamping = data.linearDamping;
    if (data.angularDamping !== undefined) this.angularDamping = data.angularDamping;
    if (data.gravityScale !== undefined) this.gravityScale = data.gravityScale;
  }
}
