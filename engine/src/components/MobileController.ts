import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { MobileInput } from '../input/MobileInput.js';
import { RigidBody3D } from './RigidBody3D.js';

export interface MobileControllerOptions {
  moveSpeed?: number;
  rotationSpeed?: number;
  jumpForce?: number;
  /** Joystick magnitude below this does not move (default 0.05). Must be >= 0. */
  deadzone?: number;
}

export class MobileController extends Component {
  public moveSpeed: number = 5.0;
  public rotationSpeed: number = 10.0;
  public jumpForce: number = 5.0;
  public deadzone: number = 0.05;

  public isMoving: boolean = false;

  private rigidBody: RigidBody3D | null = null;
  private moveDirection: THREE.Vector3 = new THREE.Vector3();

  constructor(options?: MobileControllerOptions) {
    super();
    if (options) {
      if (options.moveSpeed !== undefined) this.moveSpeed = options.moveSpeed;
      if (options.rotationSpeed !== undefined) this.rotationSpeed = options.rotationSpeed;
      if (options.jumpForce !== undefined) this.jumpForce = options.jumpForce;
      if (options.deadzone !== undefined) this.deadzone = Math.max(0, options.deadzone);
    }
  }

  public override start(): void {
    this.rigidBody = this.gameObject.getComponent(RigidBody3D);
  }

  public override update(deltaTime: number): void {
    if (!this.rigidBody) {
      this.rigidBody = this.gameObject.getComponent(RigidBody3D);
    }

    const input = MobileInput.instance;
    const jx = input.leftJoystick.x;
    const jy = input.leftJoystick.y;

    if (Math.abs(jx) > this.deadzone || Math.abs(jy) > this.deadzone) {
      this.isMoving = true;
      // Forward is along -Z in Three.js convention
      this.moveDirection.set(jx, 0, -jy).normalize();

      if (this.rigidBody && this.rigidBody.rapierBody && this.rigidBody.bodyType === 'dynamic') {
        const vel = this.rigidBody.rapierBody.linvel();
        this.rigidBody.setLinearVelocity(
          this.moveDirection.x * this.moveSpeed,
          vel.y,
          this.moveDirection.z * this.moveSpeed
        );
      } else {
        // Direct kinematic transform translation fallback
        this.gameObject.transform.translate(
          this.moveDirection.x * this.moveSpeed * deltaTime,
          0,
          this.moveDirection.z * this.moveSpeed * deltaTime
        );
      }

      // Rotate towards movement direction
      const targetAngle = Math.atan2(this.moveDirection.x, this.moveDirection.z);
      const currentAngle = this.gameObject.transform.rotation.y;
      const angleDiff = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
      this.gameObject.transform.rotateY(angleDiff * Math.min(1.0, this.rotationSpeed * deltaTime));

      if (this.rigidBody && this.rigidBody.rapierBody) {
        this.rigidBody.rapierBody.setRotation({
          x: this.gameObject.transform.quaternion.x,
          y: this.gameObject.transform.quaternion.y,
          z: this.gameObject.transform.quaternion.z,
          w: this.gameObject.transform.quaternion.w
        }, true);
      }
    } else {
      this.isMoving = false;
      if (this.rigidBody && this.rigidBody.rapierBody && this.rigidBody.bodyType === 'dynamic') {
        const vel = this.rigidBody.rapierBody.linvel();
        this.rigidBody.setLinearVelocity(0, vel.y, 0);
      }
    }

    // Handle Jump
    if (input.getButton('jump')) {
      if (this.rigidBody && this.rigidBody.rapierBody && this.rigidBody.bodyType === 'dynamic') {
        const vel = this.rigidBody.rapierBody.linvel();
        if (Math.abs(vel.y) < 0.35) {
          this.rigidBody.applyImpulse(0, this.jumpForce, 0);
        }
      }
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'MobileController',
      enabled: this.enabled,
      moveSpeed: this.moveSpeed,
      rotationSpeed: this.rotationSpeed,
      jumpForce: this.jumpForce,
      deadzone: this.deadzone
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.moveSpeed !== undefined) this.moveSpeed = data.moveSpeed;
    if (data.rotationSpeed !== undefined) this.rotationSpeed = data.rotationSpeed;
    if (data.jumpForce !== undefined) this.jumpForce = data.jumpForce;
    if (data.deadzone !== undefined) this.deadzone = Math.max(0, data.deadzone);
  }
}
