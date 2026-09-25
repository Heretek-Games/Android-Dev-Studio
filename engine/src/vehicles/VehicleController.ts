import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Component } from '../core/Component.js';
import { RigidBody3D } from '../components/RigidBody3D.js';

/**
 * VehicleController — vehicular physics for the urban-sandbox genre, built on
 * Rapier3D's battle-tested `DynamicRayCastVehicleController` (raycast
 * suspension + tire impulse solver).
 *
 * The component is a typed, engine-native wrapper:
 *   - declarative wheel configs (offset, radius, driven/steered, suspension,
 *     friction) applied to the solver at first update
 *   - per-frame inputs: throttle / steering / brake
 *   - telemetry: grounded state, suspension length/force, impulses, contact
 *     normal, wheel rotation — all read back from the solver
 *
 * Forward is -Z (three.js convention). Works headless (Rapier WASM, no GPU).
 */

export interface WheelSuspensionConfig {
  /** Suspension rest length in meters (default 0.4). */
  restLength?: number;
  /** Spring stiffness (Rapier units, default 30). */
  stiffness?: number;
  /** Compression damping ratio 0..1 (default 0.85). */
  compression?: number;
  /** Relaxation damping ratio 0..1 (default 0.95). */
  relaxation?: number;
  /** Maximum suspension travel in meters (default 0.3). */
  maxTravel?: number;
  /** Force cap in Newtons (default 30000). */
  maxForce?: number;
}

export interface WheelConfig {
  name?: string;
  /** Local-space attachment point relative to the chassis origin. */
  offset: [number, number, number];
  radius?: number;
  driven?: boolean;
  steered?: boolean;
  suspension?: WheelSuspensionConfig;
  friction?: {
    /** Longitudinal friction slip (Rapier `frictionSlip`, default 10.5). */
    slip?: number;
    /** Side friction stiffness (Rapier `sideFrictionStiffness`, default 1.0). */
    sideStiffness?: number;
  };
}

export interface VehicleConfig {
  wheels: WheelConfig[];
  /** Engine force per driven wheel at full throttle (default 3000). */
  engineForce?: number;
  /** Brake force applied per wheel at full brake input (default 40). */
  brakeForce?: number;
  /** Maximum steer angle in radians (default 0.5). */
  maxSteerAngle?: number;
}

export interface VehicleWheelState {
  name: string;
  grounded: boolean;
  /** Compression from rest length in meters (0 = fully extended). */
  compression: number;
  suspensionForce: number;
  forwardImpulse: number;
  sideImpulse: number;
  rotation: number;
  contactNormal: { x: number; y: number; z: number } | null;
}

const SUSPENSION_DEFAULTS: Required<WheelSuspensionConfig> = {
  restLength: 0.4,
  stiffness: 30,
  compression: 0.85,
  relaxation: 0.95,
  maxTravel: 0.3,
  maxForce: 30000
};

const FRICTION_DEFAULTS = { slip: 10.5, sideStiffness: 1.0 };

export class VehicleController extends Component {
  public throttle = 0; // -1..1
  public steering = 0; // -1..1 (+ = right)
  public brake = 0; // 0..1

  public readonly config: Required<Omit<VehicleConfig, 'wheels'>> & { wheels: WheelConfig[] };
  public wheelStates: VehicleWheelState[] = [];

  private vehicle: RAPIER.DynamicRayCastVehicleController | null = null;
  private readonly wheelRotationAccum: number[];
  private readonly forwardVec = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly wheelSpecs: Array<
    WheelConfig & { suspension: Required<WheelSuspensionConfig>; friction: typeof FRICTION_DEFAULTS }
  >;

  constructor(config: VehicleConfig) {
    super();
    if (!config.wheels?.length) throw new Error('VehicleController requires at least one wheel');
    this.config = {
      engineForce: config.engineForce ?? 3000,
      brakeForce: config.brakeForce ?? 40,
      maxSteerAngle: config.maxSteerAngle ?? 0.5,
      wheels: config.wheels
    };
    this.wheelSpecs = config.wheels.map((wheel, i) => ({
      ...wheel,
      name: wheel.name ?? `wheel_${i}`,
      radius: wheel.radius ?? 0.35,
      driven: wheel.driven ?? false,
      steered: wheel.steered ?? false,
      suspension: { ...SUSPENSION_DEFAULTS, ...(wheel.suspension ?? {}) },
      friction: { ...FRICTION_DEFAULTS, ...(wheel.friction ?? {}) }
    }));
    this.wheelStates = this.wheelSpecs.map(spec => ({
      name: spec.name!,
      grounded: false,
      compression: 0,
      suspensionForce: 0,
      forwardImpulse: 0,
      sideImpulse: 0,
      rotation: 0,
      contactNormal: null
    }));
    this.wheelRotationAccum = this.wheelSpecs.map(() => 0);
  }

  /** Creates the Rapier vehicle solver and applies the declarative wheel config. */
  private ensureVehicle(physics: NonNullable<RigidBody3D['world']>, chassis: RAPIER.RigidBody): RAPIER.DynamicRayCastVehicleController | null {
    if (this.vehicle) return this.vehicle;
    if (!physics.world) return null;

    const vehicle = physics.world.createVehicleController(chassis);
    this.wheelSpecs.forEach((spec, i) => {
      const suspension = spec.suspension;
      vehicle.addWheel(
        { x: spec.offset[0], y: spec.offset[1], z: spec.offset[2] },
        { x: 0, y: -1, z: 0 }, // suspension direction (down)
        { x: 1, y: 0, z: 0 }, // axle (wheel spin axis; +X makes wheel-forward = -Z)
        suspension.restLength,
        spec.radius!
      );
      vehicle.setWheelSuspensionStiffness(i, suspension.stiffness);
      vehicle.setWheelSuspensionCompression(i, suspension.compression);
      vehicle.setWheelSuspensionRelaxation(i, suspension.relaxation);
      vehicle.setWheelMaxSuspensionTravel(i, suspension.maxTravel);
      vehicle.setWheelMaxSuspensionForce(i, suspension.maxForce);
      vehicle.setWheelFrictionSlip(i, spec.friction.slip);
      vehicle.setWheelSideFrictionStiffness(i, spec.friction.sideStiffness);
    });
    this.vehicle = vehicle;
    return vehicle;
  }

  public override update(dt: number): void {
    const rb = this.gameObject.getComponent(RigidBody3D);
    const physics = rb?.world;
    if (!rb?.rapierBody || rb.bodyType !== 'dynamic' || !physics?.world) return;

    const vehicle = this.ensureVehicle(physics, rb.rapierBody);
    if (!vehicle) return;

    const steerAngle = this.steering * this.config.maxSteerAngle;
    this.wheelSpecs.forEach((spec, i) => {
      vehicle.setWheelEngineForce(i, spec.driven ? this.throttle * this.config.engineForce : 0);
      vehicle.setWheelBrake(i, this.brake * this.config.brakeForce);
      vehicle.setWheelSteering(i, spec.steered ? steerAngle : 0);
    });

    vehicle.updateVehicle(dt);

    // Signed forward speed from the chassis velocity (for wheel-spin telemetry)
    const linvel = rb.rapierBody.linvel();
    this.quat.setFromEuler(this.gameObject.transform.rotation);
    this.forwardVec.set(0, 0, -1).applyQuaternion(this.quat);
    const signedSpeed = linvel.x * this.forwardVec.x + linvel.y * this.forwardVec.y + linvel.z * this.forwardVec.z;

    this.wheelSpecs.forEach((spec, i) => {
      const suspensionLength = vehicle.wheelSuspensionLength(i);
      const state = this.wheelStates[i];
      state.grounded = vehicle.wheelIsInContact(i);
      state.compression =
        suspensionLength === null || suspensionLength === undefined
          ? 0
          : Math.max(0, Math.min(spec.suspension.maxTravel, spec.suspension.restLength - suspensionLength));
      state.suspensionForce = vehicle.wheelSuspensionForce(i) ?? 0;
      state.forwardImpulse = vehicle.wheelForwardImpulse(i) ?? 0;
      state.sideImpulse = vehicle.wheelSideImpulse(i) ?? 0;
      // Rapier does not integrate wheel spin; roll it from chassis speed.
      this.wheelRotationAccum[i] += (signedSpeed / spec.radius!) * dt;
      state.rotation = this.wheelRotationAccum[i];
      const normal = vehicle.wheelContactNormal(i);
      state.contactNormal = normal ? { x: normal.x, y: normal.y, z: normal.z } : null;
    });
  }

  /** Current forward speed reported by the solver (m/s). */
  public get speed(): number {
    return this.vehicle?.currentVehicleSpeed() ?? 0;
  }

  public override onDestroy(): void {
    if (this.vehicle) {
      this.vehicle.free();
      this.vehicle = null;
    }
  }
}
