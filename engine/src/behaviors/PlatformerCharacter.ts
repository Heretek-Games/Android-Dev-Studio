import { Component } from '../core/Component.js';
import { MobileInput } from '../input/MobileInput.js';
import { RigidBody3D } from '../components/RigidBody3D.js';
import { Platform } from './Platform.js';

export interface PlatformerCharacterOptions {
  moveSpeed?: number;
  jumpForce?: number;
  gravity?: number;
  /** Grace period after leaving a ledge during which jumps still work. */
  coyoteTime?: number;
  /** Total mid-air jumps allowed (2 = double jump). Default 1. */
  maxJumps?: number;
  /** Scripted input for headless/AI control; overrides the stick. */
  simulate?: { x: number; jump: boolean } | null;
}

/**
 * Platformer character behavior (Track 1.3 behavior library, GDevelop-informed).
 *
 * Kinematic run + jump with coyote time and multi-jump, resolving landings
 * against the ground plane (y=0) and Platform-marked boxes (solid always,
 * jumpthru only when falling onto the top face). Deterministic and
 * headless-testable via `simulate`; dynamic RigidBody3D syncs velocity when
 * present, otherwise the transform integrates directly.
 */
export class PlatformerCharacter extends Component {
  public moveSpeed: number = 5.0;
  public jumpForce: number = 8.0;
  public gravity: number = 22.0;
  public coyoteTime: number = 0.1;
  public maxJumps: number = 1;
  public simulate: { x: number; jump: boolean } | null = null;

  public isGrounded: boolean = false;
  public jumpsUsed: number = 0;

  private vy: number = 0;
  private coyoteLeft: number = 0;
  private jumpHeld: boolean = false;
  private rigidBody: RigidBody3D | null = null;

  constructor(options?: PlatformerCharacterOptions) {
    super();
    if (options) {
      if (options.moveSpeed !== undefined) this.moveSpeed = options.moveSpeed;
      if (options.jumpForce !== undefined) this.jumpForce = options.jumpForce;
      if (options.gravity !== undefined) this.gravity = options.gravity;
      if (options.coyoteTime !== undefined) this.coyoteTime = options.coyoteTime;
      if (options.maxJumps !== undefined) this.maxJumps = Math.max(1, Math.floor(options.maxJumps));
      if (options.simulate !== undefined) this.simulate = options.simulate;
    }
  }

  public override start(): void {
    this.rigidBody = this.gameObject.getComponent(RigidBody3D);
  }

  /** Queues a jump (touch button / AI / tests). */
  public jump(): void {
    this.jumpHeld = true;
  }

  public override update(deltaTime: number): void {
    if (!this.rigidBody) {
      this.rigidBody = this.gameObject.getComponent(RigidBody3D);
    }
    const t = this.gameObject.transform;
    let moveX: number;
    let wantJump: boolean;
    if (this.simulate) {
      moveX = this.simulate.x;
      wantJump = this.simulate.jump || this.jumpHeld;
    } else {
      const input = MobileInput.instance;
      moveX = input.leftJoystick.x;
      wantJump = input.getButton('jump') || this.jumpHeld;
    }
    this.jumpHeld = false;

    const prevFeetY = t.position.y;
    if (this.isGrounded) {
      this.coyoteLeft = this.coyoteTime;
      this.jumpsUsed = 0;
    } else {
      this.coyoteLeft = Math.max(0, this.coyoteLeft - deltaTime);
    }

    if (wantJump && (this.isGrounded || this.coyoteLeft > 0 || this.jumpsUsed < this.maxJumps)) {
      this.vy = this.jumpForce;
      this.jumpsUsed++;
      this.coyoteLeft = 0;
      this.isGrounded = false;
    }

    this.vy -= this.gravity * deltaTime;
    const newX = t.position.x + moveX * this.moveSpeed * deltaTime;
    let newY = t.position.y + this.vy * deltaTime;

    // Landing resolution: ground plane + Platform boxes (top faces only).
    let landed: number | null = null;
    if (this.vy <= 0) {
      if (prevFeetY >= 0 && newY <= 0) landed = 0;
      const scene = this.gameObject.scene;
      if (scene) {
        for (const other of scene.gameObjects) {
          if (other === this.gameObject) continue;
          const platform = other.getComponent(Platform);
          if (!platform || !platform.enabled) continue;
          const op = other.transform.position;
          const os = PlatformerCharacter.footprint(other);
          const top = op.y + os[1] / 2;
          const withinX = Math.abs(newX - op.x) <= os[0] / 2 + 0.3;
          const withinZ = Math.abs(t.position.z - op.z) <= os[2] / 2 + 0.3;
          if (withinX && withinZ && prevFeetY >= top - 0.001 && newY <= top) {
            if (landed === null || top > landed) landed = top;
          }
        }
      }
    }
    t.position.x = newX;
    if (landed !== null) {
      t.position.y = landed;
      this.vy = 0;
      this.isGrounded = true;
    } else {
      t.position.y = newY;
      this.isGrounded = false;
    }

    if (this.rigidBody && this.rigidBody.rapierBody && this.rigidBody.bodyType === 'dynamic') {
      const vel = this.rigidBody.rapierBody.linvel();
      this.rigidBody.setLinearVelocity(moveX * this.moveSpeed, this.vy, vel.z);
    }
  }

  private static footprint(go: {
    transform: { position: { x: number; y: number; z: number } };
  }): [number, number, number] {
    const comps = (go as unknown as { components: Array<{ size?: unknown }> }).components;
    for (const c of comps ?? []) {
      const size = c.size;
      if (Array.isArray(size) && size.length >= 3) {
        return [Number(size[0]) || 1, Number(size[1]) || 1, Number(size[2]) || 1];
      }
    }
    return [1, 1, 1];
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'PlatformerCharacter',
      enabled: this.enabled,
      moveSpeed: this.moveSpeed,
      jumpForce: this.jumpForce,
      gravity: this.gravity,
      coyoteTime: this.coyoteTime,
      maxJumps: this.maxJumps
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (data.moveSpeed !== undefined) this.moveSpeed = data.moveSpeed;
    if (data.jumpForce !== undefined) this.jumpForce = data.jumpForce;
    if (data.gravity !== undefined) this.gravity = data.gravity;
    if (data.coyoteTime !== undefined) this.coyoteTime = data.coyoteTime;
    if (data.maxJumps !== undefined) this.maxJumps = data.maxJumps;
  }
}
