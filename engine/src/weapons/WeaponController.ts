import * as THREE from 'three';
import { Component } from '../core/Component.js';

export interface WeaponConfig {
  name?: string;
  fireRate?: number; // Shots per second (e.g. 10 = 600 RPM)
  damage?: number;
  range?: number;
  maxAmmo?: number;
  reloadTime?: number;
  spreadBloom?: number; // Cone spread in radians
  recoilKick?: number; // Upward pitch kick in degrees
}

export interface HitResult {
  hit: boolean;
  distance: number;
  point?: [number, number, number];
  hitObjectName?: string;
}

/**
 * FPS Weapon Ballistics Controller (Call of Duty Mobile / Doom Scope):
 * Manages rapid-fire raycast hit detection, ammo reloading state machines,
 * procedural viewmodel recoil kick, and spread bloom recovery.
 */
export class WeaponController extends Component {
  public weaponName: string = 'Plasma Assault Rifle';
  public fireRate: number = 8.0; // 8 shots/sec
  public damage: number = 25.0;
  public range: number = 100.0;
  public maxAmmo: number = 30;
  public currentAmmo: number = 30;
  public reloadTime: number = 1.8;
  public spreadBloom: number = 0.02;
  public recoilKick: number = 1.5;

  private fireCooldown: number = 0.0;
  private reloadTimer: number = 0.0;
  public isReloading: boolean = false;
  public currentRecoil: number = 0.0;

  // Pre-allocated scratch objects to maintain ZERO per-frame GC allocations
  private readonly raycaster: THREE.Raycaster = new THREE.Raycaster();
  private readonly originVec: THREE.Vector3 = new THREE.Vector3();
  private readonly forwardVec: THREE.Vector3 = new THREE.Vector3();

  constructor(config?: WeaponConfig) {
    super();
    if (config) {
      if (config.name) this.weaponName = config.name;
      if (config.fireRate !== undefined) this.fireRate = config.fireRate;
      if (config.damage !== undefined) this.damage = config.damage;
      if (config.range !== undefined) this.range = config.range;
      if (config.maxAmmo !== undefined) {
        this.maxAmmo = config.maxAmmo;
        this.currentAmmo = config.maxAmmo;
      }
      if (config.reloadTime !== undefined) this.reloadTime = config.reloadTime;
      if (config.spreadBloom !== undefined) this.spreadBloom = config.spreadBloom;
      if (config.recoilKick !== undefined) this.recoilKick = config.recoilKick;
    }
  }

  public canFire(): boolean {
    return !this.isReloading && this.currentAmmo > 0 && this.fireCooldown <= 0;
  }

  public fire(): HitResult {
    if (!this.canFire()) {
      if (this.currentAmmo === 0 && !this.isReloading) {
        this.reload();
      }
      return { hit: false, distance: 0 };
    }

    this.currentAmmo--;
    this.fireCooldown = 1.0 / this.fireRate;
    this.currentRecoil = Math.min(this.currentRecoil + this.recoilKick, 12.0);

    // Compute raycast direction with recoil offset and spread
    const t = this.gameObject?.transform;
    const px = t ? t.position.x : 0;
    const py = t ? t.position.y + 0.8 : 0.8;
    const pz = t ? t.position.z : 0;
    this.originVec.set(px, py, pz);
    this.forwardVec.set(0, 0, -1);
    if (t) {
      this.forwardVec.applyQuaternion(t.quaternion);
    }

    // Apply procedural spread cone
    const spreadX = (Math.random() - 0.5) * this.spreadBloom;
    const spreadY = (Math.random() - 0.5) * this.spreadBloom;
    this.forwardVec.x += spreadX;
    this.forwardVec.y += spreadY;
    this.forwardVec.normalize();

    this.raycaster.set(this.originVec, this.forwardVec);
    this.raycaster.far = this.range;

    // Check hit against active Three scene if present
    if (this.gameObject?.scene?.threeScene) {
      const hits = this.raycaster.intersectObjects(this.gameObject.scene.threeScene.children, true);
      // Filter out self
      const validHit = hits.find(h => {
        let parent: THREE.Object3D | null = h.object;
        while (parent) {
          if (parent.userData?.gameObject === this.gameObject) return false;
          parent = parent.parent;
        }
        return true;
      });

      if (validHit) {
        return {
          hit: true,
          distance: validHit.distance,
          point: [validHit.point.x, validHit.point.y, validHit.point.z],
          hitObjectName: validHit.object.name || 'Environment'
        };
      }
    }

    return { hit: false, distance: this.range };
  }

  public reload(): void {
    if (this.isReloading || this.currentAmmo === this.maxAmmo) return;
    this.isReloading = true;
    this.reloadTimer = this.reloadTime;
  }

  public override update(deltaTime: number): void {
    // Cooldown recovery
    if (this.fireCooldown > 0) {
      this.fireCooldown -= deltaTime;
    }

    // Recoil recovery
    if (this.currentRecoil > 0) {
      this.currentRecoil = Math.max(0, this.currentRecoil - 18.0 * deltaTime);
    }

    // Reload state machine
    if (this.isReloading) {
      this.reloadTimer -= deltaTime;
      if (this.reloadTimer <= 0) {
        this.currentAmmo = this.maxAmmo;
        this.isReloading = false;
      }
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'WeaponController',
      weaponName: this.weaponName,
      currentAmmo: this.currentAmmo,
      maxAmmo: this.maxAmmo,
      fireRate: this.fireRate,
      damage: this.damage
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.weaponName) this.weaponName = data.weaponName;
    if (data.currentAmmo !== undefined) this.currentAmmo = data.currentAmmo;
    if (data.maxAmmo !== undefined) this.maxAmmo = data.maxAmmo;
    if (data.fireRate !== undefined) this.fireRate = data.fireRate;
    if (data.damage !== undefined) this.damage = data.damage;
  }
}
