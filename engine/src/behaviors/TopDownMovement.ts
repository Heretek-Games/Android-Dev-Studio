import { Component } from '../core/Component.js';
import { MobileInput } from '../input/MobileInput.js';
import { RigidBody3D } from '../components/RigidBody3D.js';

export interface TopDownMovementOptions {
  moveSpeed?: number;
  /** Allow diagonal movement (8 directions) instead of 4. Default true. */
  allowDiagonals?: boolean;
  /** Rotate the object to face the movement heading. Default true. */
  rotateToHeading?: boolean;
  /** Simulated input vector for headless/AI control; overrides the stick. */
  simulate?: { x: number; y: number } | null;
}

/**
 * Top-down movement behavior (Track 1.3 behavior library, GDevelop-informed).
 *
 * 4/8-direction planar movement on XZ from the left stick (or an injected
 * simulated vector, which also drives headless QA and NPC control), with
 * optional facing rotation. Kinematic transform motion plus dynamic-body
 * velocity sync, mirroring MobileController conventions.
 */
export class TopDownMovement extends Component {
  public moveSpeed: number = 5.0;
  public allowDiagonals: boolean = true;
  public rotateToHeading: boolean = true;
  public simulate: { x: number; y: number } | null = null;

  public isMoving: boolean = false;
  public movementAngle: number = 0;

  private rigidBody: RigidBody3D | null = null;

  constructor(options?: TopDownMovementOptions) {
    super();
    if (options) {
      if (options.moveSpeed !== undefined) this.moveSpeed = options.moveSpeed;
      if (options.allowDiagonals !== undefined) this.allowDiagonals = options.allowDiagonals;
      if (options.rotateToHeading !== undefined) this.rotateToHeading = options.rotateToHeading;
      if (options.simulate !== undefined) this.simulate = options.simulate;
    }
  }

  public override start(): void {
    this.rigidBody = this.gameObject.getComponent(RigidBody3D);
  }

  public override update(deltaTime: number): void {
    if (!this.rigidBody) {
      this.rigidBody = this.gameObject.getComponent(RigidBody3D);
    }
    let jx: number;
    let jy: number;
    if (this.simulate) {
      jx = this.simulate.x;
      jy = this.simulate.y;
    } else {
      const input = MobileInput.instance;
      jx = input.leftJoystick.x;
      jy = input.leftJoystick.y;
    }
    if (!this.allowDiagonals) {
      if (Math.abs(jx) >= Math.abs(jy)) {
        jy = 0;
      } else {
        jx = 0;
      }
    }
    const magnitude = Math.hypot(jx, jy);
    if (magnitude < 0.05 || this.moveSpeed <= 0) {
      this.isMoving = false;
      return;
    }
    this.isMoving = true;
    // Forward is -Z (Three.js convention); matches MobileController mapping.
    const dx = jx / magnitude;
    const dz = -jy / magnitude;
    this.movementAngle = Math.atan2(dx, -dz);

    if (this.rigidBody && this.rigidBody.rapierBody && this.rigidBody.bodyType === 'dynamic') {
      const vel = this.rigidBody.rapierBody.linvel();
      this.rigidBody.setLinearVelocity(
        dx * this.moveSpeed,
        vel.y,
        dz * this.moveSpeed
      );
    } else {
      this.gameObject.transform.translate(
        dx * this.moveSpeed * deltaTime,
        0,
        dz * this.moveSpeed * deltaTime
      );
    }
    if (this.rotateToHeading) {
      this.gameObject.transform.rotation.y = this.movementAngle;
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'TopDownMovement',
      enabled: this.enabled,
      moveSpeed: this.moveSpeed,
      allowDiagonals: this.allowDiagonals,
      rotateToHeading: this.rotateToHeading,
      simulate: this.simulate
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (data.moveSpeed !== undefined) this.moveSpeed = data.moveSpeed;
    if (data.allowDiagonals !== undefined) this.allowDiagonals = data.allowDiagonals;
    if (data.rotateToHeading !== undefined) this.rotateToHeading = data.rotateToHeading;
    if (data.simulate !== undefined) this.simulate = data.simulate;
  }
}
