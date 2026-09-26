import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { registerInspectorSchema } from '../core/InspectorSchema.js';

export type ParticleShape = 'point' | 'box' | 'sphere';
export type ParticleBlending = 'additive' | 'normal';

export interface ParticleEmitterOptions {
  maxParticles?: number;
  /** Emission rate per second. Default 32. */
  rate?: number;
  /** Extra particles emitted on start and every loop restart. Default 0. */
  burst?: number;
  /** Active seconds per cycle (0 = infinite). Default 0. */
  duration?: number;
  /** Restart emission when duration elapses. Default true. */
  loop?: boolean;
  shape?: ParticleShape;
  /** Box extents or sphere radius around the owner. Default [1, 1, 1]. */
  shapeSize?: [number, number, number];
  /** Base velocity direction. Default [0, 1, 0]. */
  direction?: [number, number, number];
  /** Cone half-angle in radians around direction. Default 0.3. */
  spread?: number;
  speedMin?: number;
  speedMax?: number;
  /** Downward acceleration (negative rises). Default 0. */
  gravity?: number;
  /** Linear velocity damping per second. Default 0. */
  drag?: number;
  lifetimeMin?: number;
  lifetimeMax?: number;
  sizeMin?: number;
  sizeMax?: number;
  startColor?: string;
  endColor?: string;
  /** Global alpha multiplier. Default 1. */
  opacity?: number;
  blending?: ParticleBlending;
  /** Deterministic RNG seed. Default 1234. */
  seed?: number;
  /** Start emitting on attach. Default true. */
  autostart?: boolean;
  /** Scalability tier (Niagara-lite S/A/X). Default 'A'. */
  tier?: ParticleTier;
  /** Frame-time governor (auto step-down on sustained overruns). Default false. */
  governorEnabled?: boolean;
}

export type ParticleTier = 'S' | 'A' | 'X';

/** Niagara-lite scalability caps (alive cap, rate scale, sprite-size scale). */
export const TIER_CAPS: Record<ParticleTier, { max: number; rateScale: number; sizeScale: number }> = {
  S: { max: 512, rateScale: 0.5, sizeScale: 0.75 },
  A: { max: 2048, rateScale: 1.0, sizeScale: 1.0 },
  X: { max: 8192, rateScale: 1.5, sizeScale: 1.25 }
};

/** Device class -> tier (low phones S, mids A, desktops/high X). */
export function tierForDeviceClass(deviceClass: 'low' | 'mid' | 'high'): ParticleTier {
  return deviceClass === 'low' ? 'S' : deviceClass === 'high' ? 'X' : 'A';
}

/** Capability probe -> device class (WebGL caps; pure, headless-testable). */
export function probeDeviceClass(caps: { maxTextureSize?: number }): 'low' | 'mid' | 'high' {
  const size = caps.maxTextureSize ?? 4096;
  if (size <= 2048) return 'low';
  if (size <= 8192) return 'mid';
  return 'high';
}

/** Boundary tolerance for IEEE754 emitter-clock accumulation. */
const EMIT_EPSILON = 1e-9;

/**
 * ParticleSystem behavior (Track 1.5, ADR-1790372769703).
 *
 * Phase-1 CPU-sim ring buffer (fixed capacity, seeded mulberry32 RNG,
 * fixed-dt semi-implicit Euler) drawn as ONE THREE.Points draw call with a
 * soft-sprite ShaderMaterial. WebGL2 has no compute shaders, so GPU-sim is
 * deferred to Phase 2 (transform-feedback fast path / Tier-2 native
 * compute); per-particle sorting, collision, sub-emitters, and trails are
 * explicit non-goals this phase. Headless-deterministic: identical seeds
 * and step sequences produce identical pools.
 */
export class ParticleSystem extends Component {
  public maxParticles: number = 256;
  public rate: number = 32;
  public burst: number = 0;
  public duration: number = 0;
  public loop: boolean = true;
  public shape: ParticleShape = 'point';
  public shapeSize: [number, number, number] = [1, 1, 1];
  public direction: [number, number, number] = [0, 1, 0];
  public spread: number = 0.3;
  public speedMin: number = 1;
  public speedMax: number = 3;
  public gravity: number = 0;
  public drag: number = 0;
  public lifetimeMin: number = 1;
  public lifetimeMax: number = 2;
  public sizeMin: number = 0.1;
  public sizeMax: number = 0.3;
  public startColor: string = '#ffffff';
  public endColor: string = '#ffffff';
  public opacity: number = 1;
  public blending: ParticleBlending = 'additive';
  public seed: number = 1234;
  public emitting: boolean = true;
  public tier: ParticleTier = 'A';
  public governorEnabled: boolean = false;
  /** Frame-time ms above which the governor steps down (sustained). */
  public governorThresholdMs: number = 25;
  public downgrades: number = 0;

  public aliveCount: number = 0;

  private baseMaxParticles: number = 256;
  private baseRate: number = 32;
  private baseSizeMin: number = 0.1;
  private baseSizeMax: number = 0.3;
  private allocated: number = 0;
  private frameEmaMs: number = 0;
  private governorWindow: number = 0;

  private pos: Float32Array = new Float32Array(0);
  private vel: Float32Array = new Float32Array(0);
  private life: Float32Array = new Float32Array(0);
  private maxLife: Float32Array = new Float32Array(0);
  private size: Float32Array = new Float32Array(0);
  private rot: Float32Array = new Float32Array(0);
  private col0: Float32Array = new Float32Array(0);
  private col1: Float32Array = new Float32Array(0);
  private rngState: number = 1234;
  private spawnAcc: number = 0;
  private emitterTime: number = 0;

  private geometry: THREE.BufferGeometry | null = null;
  private points: THREE.Points | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private attrsDirty: boolean = true;

  constructor(options?: ParticleEmitterOptions) {
    super();
    if (options) this.applyOptions(options);
    this.snapshotBases();
    this.applyTier(options?.tier ?? 'A');
    if (options?.governorEnabled !== undefined) this.governorEnabled = options.governorEnabled;
    this.rngState = this.seed >>> 0;
  }

  private applyOptions(options: ParticleEmitterOptions): void {
    const o = options;
    if (o.maxParticles !== undefined) this.maxParticles = Math.max(1, Math.floor(o.maxParticles));
    if (o.rate !== undefined) this.rate = Math.max(0, o.rate);
    if (o.burst !== undefined) this.burst = Math.max(0, Math.floor(o.burst));
    if (o.duration !== undefined) this.duration = Math.max(0, o.duration);
    if (o.loop !== undefined) this.loop = o.loop;
    if (o.shape !== undefined) this.shape = o.shape;
    if (o.shapeSize !== undefined) this.shapeSize = [o.shapeSize[0], o.shapeSize[1], o.shapeSize[2]];
    if (o.direction !== undefined) this.direction = [o.direction[0], o.direction[1], o.direction[2]];
    if (o.spread !== undefined) this.spread = Math.min(Math.PI, Math.max(0, o.spread));
    if (o.speedMin !== undefined) this.speedMin = Math.max(0, o.speedMin);
    if (o.speedMax !== undefined) this.speedMax = Math.max(this.speedMin, o.speedMax);
    if (o.gravity !== undefined) this.gravity = o.gravity;
    if (o.drag !== undefined) this.drag = Math.max(0, o.drag);
    if (o.lifetimeMin !== undefined) this.lifetimeMin = Math.max(0.01, o.lifetimeMin);
    if (o.lifetimeMax !== undefined) this.lifetimeMax = Math.max(this.lifetimeMin, o.lifetimeMax);
    if (o.sizeMin !== undefined) this.sizeMin = Math.max(0.001, o.sizeMin);
    if (o.sizeMax !== undefined) this.sizeMax = Math.max(this.sizeMin, o.sizeMax);
    if (o.startColor !== undefined) this.startColor = o.startColor;
    if (o.endColor !== undefined) this.endColor = o.endColor;
    if (o.opacity !== undefined) this.opacity = Math.min(1, Math.max(0, o.opacity));
    if (o.blending !== undefined) this.blending = o.blending;
    if (o.seed !== undefined) this.seed = o.seed >>> 0;
    if (o.autostart !== undefined) this.emitting = o.autostart;
  }

  private allocate(): void {
    const n = this.maxParticles;
    this.allocated = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.col0 = new Float32Array(n * 3);
    this.col1 = new Float32Array(n * 3);
    this.aliveCount = 0;
    this.spawnAcc = 0;
    this.geometry = null;
    this.points = null;
    this.material = null;
  }

  /** Snapshots tier bases (construction/authoring values; tiers scale these). */
  private snapshotBases(): void {
    this.baseMaxParticles = this.maxParticles;
    this.baseRate = this.rate;
    this.baseSizeMin = this.sizeMin;
    this.baseSizeMax = this.sizeMax;
  }

  /**
   * Applies a scalability tier from the bases (idempotent — never compounds).
   * Growing past allocated capacity reallocates (pool restarts, Godot amount
   * semantics); shrinking truncates the pool cap in place. Re-attaches the
   * draw object when it was already in the scene graph.
   */
  public applyTier(tier: ParticleTier): void {
    this.tier = tier;
    const cap = TIER_CAPS[tier];
    this.maxParticles = Math.min(this.baseMaxParticles, cap.max);
    this.rate = this.baseRate * cap.rateScale;
    this.sizeMin = this.baseSizeMin * cap.sizeScale;
    this.sizeMax = this.baseSizeMax * cap.sizeScale;
    if (this.maxParticles > this.allocated) {
      const scene = this.gameObject?.scene ?? null;
      const parent = this.points?.parent ?? null;
      this.allocate();
      this.geometry = null;
      this.points = null;
      this.material = null;
      this.ensureDraw();
      const rebuilt = this.points as THREE.Points | null;
      if (parent && rebuilt && !rebuilt.parent) {
        parent.add(rebuilt);
      }
    } else {
      this.aliveCount = Math.min(this.aliveCount, this.maxParticles);
    }
    this.attrsDirty = true;
  }

  /** Convenience: probe caps (or explicit class) -> tier -> apply. */
  public autoTier(
    deviceClass: 'low' | 'mid' | 'high' | { maxTextureSize?: number }
  ): ParticleTier {
    const tier = typeof deviceClass === 'string'
      ? tierForDeviceClass(deviceClass)
      : tierForDeviceClass(probeDeviceClass(deviceClass));
    this.applyTier(tier);
    return tier;
  }

  /**
   * Frame-time governor sample (wall ms, called by the app loop — never by
   * update(), keeping sim determinism). Sustained overruns step down a tier.
   */
  public governorSample(frameMs: number): void {
    if (!this.governorEnabled) return;
    const alpha = 0.1;
    this.frameEmaMs = this.frameEmaMs === 0 ? frameMs : this.frameEmaMs + (frameMs - this.frameEmaMs) * alpha;
    this.governorWindow++;
    if (this.governorWindow >= 60) {
      this.governorWindow = 0;
      if (this.frameEmaMs > this.governorThresholdMs) {
        const next = this.tier === 'X' ? 'A' : this.tier === 'A' ? 'S' : null;
        if (next) {
          this.applyTier(next);
          this.downgrades++;
        }
      }
    }
  }

  /** Fill load in px² plus overdraw vs a viewport (tile-GPU budget math). */
  public fillLoadPx(pixelsPerUnit: number, viewportW: number, viewportH: number): { load: number; overdraw: number } {
    let load = 0;
    for (let i = 0; i < this.aliveCount; i++) {
      const px = this.size[i] * pixelsPerUnit;
      load += px * px;
    }
    const area = Math.max(1, viewportW * viewportH);
    return { load, overdraw: load / area };
  }

  /** Budget audit (headless gate): alive cap + overdraw ceiling. */
  public auditBudget(options?: {
    maxAlive?: number;
    maxOverdraw?: number;
    pixelsPerUnit?: number;
    viewportW?: number;
    viewportH?: number;
  }): { pass: boolean; checks: string[] } {
    const checks: string[] = [];
    let pass = true;
    if (options?.maxAlive !== undefined && this.aliveCount > options.maxAlive) {
      pass = false;
      checks.push(`alive ${this.aliveCount} exceeds cap ${options.maxAlive} (tier ${this.tier} caps ${TIER_CAPS[this.tier].max})`);
    }
    if (options?.maxOverdraw !== undefined) {
      const { overdraw } = this.fillLoadPx(
        options.pixelsPerUnit ?? 20, options.viewportW ?? 1280, options.viewportH ?? 720
      );
      if (overdraw > options.maxOverdraw) {
        pass = false;
        checks.push(`overdraw ${overdraw.toFixed(2)} exceeds ${options.maxOverdraw} (tier down or shrink sprites)`);
      }
    }
    if (pass) checks.push('within budget');
    return { pass, checks };
  }

  /** Deterministic RNG (mulberry32); state serializes for exact resume. */
  private rand(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  public override start(): void {
    this.ensureDraw();
    if (this.points && this.gameObject.scene?.threeScene && !this.points.parent) {
      this.gameObject.scene.threeScene.add(this.points);
    }
    if (this.emitting && this.burst > 0) {
      this.emit(this.burst);
    }
  }

  /** Resumes emission (play/pause naming: start() is the attach lifecycle). */
  public play(): void {
    this.emitting = true;
  }

  public pause(): void {
    this.emitting = false;
  }

  /** Restarts the emitter clock and clears all live particles. */
  public restart(): void {
    this.aliveCount = 0;
    this.spawnAcc = 0;
    this.emitterTime = 0;
    this.emitting = true;
    if (this.burst > 0) this.emit(this.burst);
    this.attrsDirty = true;
  }

  /** Emits up to `count` particles now (clamped to free slots). Returns spawned. */
  public emit(count: number): number {
    let spawned = 0;
    for (let k = 0; k < count && this.aliveCount < this.maxParticles; k++) {
      this.spawnOne();
      spawned++;
    }
    this.attrsDirty = true;
    return spawned;
  }

  private spawnOne(): void {
    const i = this.aliveCount;
    const owner = this.gameObject.transform.position;
    // Shape offset.
    let ox = 0;
    let oy = 0;
    let oz = 0;
    if (this.shape === 'box') {
      ox = (this.rand() * 2 - 1) * this.shapeSize[0] / 2;
      oy = (this.rand() * 2 - 1) * this.shapeSize[1] / 2;
      oz = (this.rand() * 2 - 1) * this.shapeSize[2] / 2;
    } else if (this.shape === 'sphere') {
      const theta = this.rand() * Math.PI * 2;
      const phi = Math.acos(this.rand() * 2 - 1);
      const r = this.shapeSize[0] * Math.cbrt(this.rand());
      ox = r * Math.sin(phi) * Math.cos(theta);
      oy = r * Math.cos(phi);
      oz = r * Math.sin(phi) * Math.sin(theta);
    }
    this.pos[i * 3] = owner.x + ox;
    this.pos[i * 3 + 1] = owner.y + oy;
    this.pos[i * 3 + 2] = owner.z + oz;
    // Cone velocity around direction.
    const dx = this.direction[0];
    const dy = this.direction[1];
    const dz = this.direction[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const nz = dz / len;
    const ux = Math.abs(ny) > 0.9 ? 1 : 0;
    const uy = Math.abs(ny) > 0.9 ? 0 : 1;
    const uz = 0;
    // u = normalize(cross(n, up)); w = cross(n, u).
    let uxx = ny * uz - nz * uy;
    let uyy = nz * ux - nx * uz;
    let uzz = nx * uy - ny * ux;
    const ul = Math.hypot(uxx, uyy, uzz) || 1;
    uxx /= ul;
    uyy /= ul;
    uzz /= ul;
    const wx = ny * uzz - nz * uyy;
    const wy = nz * uxx - nx * uzz;
    const wz = nx * uyy - ny * uxx;
    const theta = this.rand() * Math.PI * 2;
    const cone = Math.tan(this.spread) * Math.sqrt(this.rand());
    const speed = this.lerp(this.speedMin, this.speedMax, this.rand());
    let vx = nx + uxx * Math.cos(theta) * cone + wx * Math.sin(theta) * cone;
    let vy = ny + uyy * Math.cos(theta) * cone + wy * Math.sin(theta) * cone;
    let vz = nz + uzz * Math.cos(theta) * cone + wz * Math.sin(theta) * cone;
    const vl = Math.hypot(vx, vy, vz) || 1;
    this.vel[i * 3] = (vx / vl) * speed;
    this.vel[i * 3 + 1] = (vy / vl) * speed;
    this.vel[i * 3 + 2] = (vz / vl) * speed;
    const lifetime = this.lerp(this.lifetimeMin, this.lifetimeMax, this.rand());
    this.life[i] = lifetime;
    this.maxLife[i] = lifetime;
    this.size[i] = this.lerp(this.sizeMin, this.sizeMax, this.rand());
    this.rot[i] = this.rand() * Math.PI * 2;
    const c0 = new THREE.Color(this.startColor);
    const c1 = new THREE.Color(this.endColor);
    this.col0[i * 3] = c0.r;
    this.col0[i * 3 + 1] = c0.g;
    this.col0[i * 3 + 2] = c0.b;
    this.col1[i * 3] = c1.r;
    this.col1[i * 3 + 1] = c1.g;
    this.col1[i * 3 + 2] = c1.b;
    this.aliveCount++;
  }

  public override update(deltaTime: number): void {
    // Eligibility is decided by pre-advance state: a pass that starts inside
    // the active window emits its full share even when the clock crosses the
    // duration cutoff mid-pass (deterministic spawn counts at boundaries).
    const activeThisPass = this.emitting;
    if (this.emitting) {
      if (this.duration > 0) {
        this.emitterTime += deltaTime;
        // EPSILON + subtract (never modulo): 60 x (1/60) sums to just under
        // 1.0 in IEEE754 — the boundary must trip on time, and modulo would
        // return the pre-duration value unchanged and double-burst next frame.
        if (this.emitterTime + EMIT_EPSILON >= this.duration) {
          if (this.loop) {
            this.emitterTime -= this.duration;
            if (this.burst > 0) this.emit(this.burst);
          } else {
            this.emitting = false;
          }
        }
      }
      if (activeThisPass && this.rate > 0) {
        this.spawnAcc += this.rate * deltaTime;
        const n = Math.floor(this.spawnAcc);
        if (n > 0) {
          this.spawnAcc -= n;
          this.emit(n);
        }
      }
    }
    // Semi-implicit Euler integration with swap-remove; keeps [0, alive) packed.
    const damp = Math.max(0, 1 - this.drag * deltaTime);
    for (let i = 0; i < this.aliveCount; i++) {
      this.life[i] -= deltaTime;
      if (this.life[i] <= 0) {
        const last = this.aliveCount - 1;
        if (i !== last) {
          for (let c = 0; c < 3; c++) {
            this.pos[i * 3 + c] = this.pos[last * 3 + c];
            this.vel[i * 3 + c] = this.vel[last * 3 + c];
            this.col0[i * 3 + c] = this.col0[last * 3 + c];
            this.col1[i * 3 + c] = this.col1[last * 3 + c];
          }
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.size[i] = this.size[last];
          this.rot[i] = this.rot[last];
        }
        this.aliveCount--;
        i--;
        continue;
      }
      this.vel[i * 3 + 1] -= this.gravity * deltaTime;
      this.vel[i * 3] *= damp;
      this.vel[i * 3 + 1] *= damp;
      this.vel[i * 3 + 2] *= damp;
      this.pos[i * 3] += this.vel[i * 3] * deltaTime;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * deltaTime;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * deltaTime;
    }
    this.attrsDirty = true;
    this.pushAttributes();
  }

  /** Builds the single-draw Points cloud (GL-free until first render). */
  public ensureDraw(): void {
    if (this.geometry) return;
    const n = this.maxParticles;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setAttribute('aColor0', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setAttribute('aColor1', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.geometry.setAttribute('aRot', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.geometry.setAttribute('aAge', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: this.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uOpacity: { value: this.opacity },
        uScale: { value: 300 }
      },
      vertexShader: `
        attribute vec3 aColor0;
        attribute vec3 aColor1;
        attribute float aSize;
        attribute float aRot;
        attribute float aAge;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vRot;
        uniform float uOpacity;
        uniform float uScale;
        void main() {
          vColor = mix(aColor0, aColor1, aAge);
          vAlpha = (1.0 - aAge) * uOpacity;
          vRot = aRot;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vRot;
        void main() {
          // gl_PointCoord is fragment-only in GLSL ES: rotate UVs here.
          float c = cos(vRot);
          float s = sin(vRot);
          vec2 uv = mat2(c, -s, s, c) * (gl_PointCoord - 0.5);
          float d = length(uv) * 2.0;
          float mask = smoothstep(1.0, 0.2, d);
          if (mask * vAlpha < 0.004) discard;
          gl_FragColor = vec4(vColor, mask * vAlpha);
        }
      `
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.pushAttributes();
  }

  private pushAttributes(): void {
    if (!this.geometry) return;
    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const aColor0 = this.geometry.getAttribute('aColor0') as THREE.BufferAttribute;
    const aColor1 = this.geometry.getAttribute('aColor1') as THREE.BufferAttribute;
    const aSize = this.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const aRot = this.geometry.getAttribute('aRot') as THREE.BufferAttribute;
    const aAge = this.geometry.getAttribute('aAge') as THREE.BufferAttribute;
    (position.array as Float32Array).set(this.pos.subarray(0, this.aliveCount * 3));
    (aColor0.array as Float32Array).set(this.col0.subarray(0, this.aliveCount * 3));
    (aColor1.array as Float32Array).set(this.col1.subarray(0, this.aliveCount * 3));
    (aSize.array as Float32Array).set(this.size.subarray(0, this.aliveCount));
    (aRot.array as Float32Array).set(this.rot.subarray(0, this.aliveCount));
    const ages = aAge.array as Float32Array;
    for (let i = 0; i < this.aliveCount; i++) {
      ages[i] = 1 - this.life[i] / this.maxLife[i];
    }
    position.needsUpdate = true;
    aColor0.needsUpdate = true;
    aColor1.needsUpdate = true;
    aSize.needsUpdate = true;
    aRot.needsUpdate = true;
    aAge.needsUpdate = true;
    this.geometry.setDrawRange(0, this.aliveCount);
    this.attrsDirty = false;
  }

  public override onDestroy(): void {
    if (this.points) {
      if (this.points.parent) this.points.parent.remove(this.points);
      this.points = null;
    }
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
  }

  private round4(values: ArrayLike<number>): number[] {
    const out: number[] = new Array(values.length);
    for (let i = 0; i < values.length; i++) out[i] = Math.round(values[i] * 10000) / 10000;
    return out;
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'ParticleSystem',
      enabled: this.enabled,
      maxParticles: this.maxParticles,
      rate: this.rate,
      burst: this.burst,
      duration: this.duration,
      loop: this.loop,
      shape: this.shape,
      shapeSize: [...this.shapeSize],
      direction: [...this.direction],
      spread: this.spread,
      speedMin: this.speedMin,
      speedMax: this.speedMax,
      gravity: this.gravity,
      drag: this.drag,
      lifetimeMin: this.lifetimeMin,
      lifetimeMax: this.lifetimeMax,
      sizeMin: this.sizeMin,
      sizeMax: this.sizeMax,
      startColor: this.startColor,
      endColor: this.endColor,
      opacity: this.opacity,
      blending: this.blending,
      seed: this.seed,
      emitting: this.emitting,
      tier: this.tier,
      baseMaxParticles: this.baseMaxParticles,
      baseRate: this.baseRate,
      baseSizeMin: this.baseSizeMin,
      baseSizeMax: this.baseSizeMax,
      governorEnabled: this.governorEnabled,
      downgrades: this.downgrades,
      aliveCount: this.aliveCount,
      rngState: this.rngState,
      spawnAcc: this.spawnAcc,
      emitterTime: this.emitterTime,
      pos: this.round4(this.pos.subarray(0, this.aliveCount * 3)),
      vel: this.round4(this.vel.subarray(0, this.aliveCount * 3)),
      // life stays full-precision: 4dp rounding would push near-death
      // particles across the <= 0 boundary and desync the packed pool.
      life: Array.from(this.life.subarray(0, this.aliveCount)),
      maxLife: Array.from(this.maxLife.subarray(0, this.aliveCount)),
      psize: this.round4(this.size.subarray(0, this.aliveCount)),
      rot: this.round4(this.rot.subarray(0, this.aliveCount)),
      col0: this.round4(this.col0.subarray(0, this.aliveCount * 3)),
      col1: this.round4(this.col1.subarray(0, this.aliveCount * 3))
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    this.applyOptions({
      maxParticles: data.maxParticles ?? this.maxParticles,
      rate: data.rate ?? this.rate,
      burst: data.burst ?? this.burst,
      duration: data.duration ?? this.duration,
      loop: data.loop ?? this.loop,
      shape: data.shape ?? this.shape,
      shapeSize: data.shapeSize ?? this.shapeSize,
      direction: data.direction ?? this.direction,
      spread: data.spread ?? this.spread,
      speedMin: data.speedMin ?? this.speedMin,
      speedMax: data.speedMax ?? this.speedMax,
      gravity: data.gravity ?? this.gravity,
      drag: data.drag ?? this.drag,
      lifetimeMin: data.lifetimeMin ?? this.lifetimeMin,
      lifetimeMax: data.lifetimeMax ?? this.lifetimeMax,
      sizeMin: data.sizeMin ?? this.sizeMin,
      sizeMax: data.sizeMax ?? this.sizeMax,
      startColor: data.startColor ?? this.startColor,
      endColor: data.endColor ?? this.endColor,
      opacity: data.opacity ?? this.opacity,
      blending: data.blending ?? this.blending,
      seed: data.seed ?? this.seed
    });
    // Reallocate only when capacity changed (constructor already allocated).
    if (this.pos.length !== this.maxParticles * 3) this.allocate();
    if (data.emitting !== undefined) this.emitting = data.emitting;
    // Tier bases (absent in pre-tier snapshots: re-snapshot from authored values).
    if (typeof data.baseMaxParticles === 'number') this.baseMaxParticles = data.baseMaxParticles;
    else this.baseMaxParticles = this.maxParticles;
    if (typeof data.baseRate === 'number') this.baseRate = data.baseRate;
    else this.baseRate = this.rate;
    if (typeof data.baseSizeMin === 'number') this.baseSizeMin = data.baseSizeMin;
    else this.baseSizeMin = this.sizeMin;
    if (typeof data.baseSizeMax === 'number') this.baseSizeMax = data.baseSizeMax;
    else this.baseSizeMax = this.sizeMax;
    if (typeof data.tier === 'string' && (data.tier === 'S' || data.tier === 'A' || data.tier === 'X')) {
      this.tier = data.tier;
    }
    if (typeof data.governorEnabled === 'boolean') this.governorEnabled = data.governorEnabled;
    if (typeof data.downgrades === 'number') this.downgrades = data.downgrades;
    if (typeof data.rngState === 'number') this.rngState = data.rngState >>> 0;
    if (typeof data.spawnAcc === 'number') this.spawnAcc = data.spawnAcc;
    if (typeof data.emitterTime === 'number') this.emitterTime = data.emitterTime;
    const alive = typeof data.aliveCount === 'number'
      ? Math.min(this.maxParticles, Math.max(0, Math.floor(data.aliveCount)))
      : 0;
    const set = (dst: Float32Array, src: unknown, per: number): void => {
      if (Array.isArray(src)) {
        const n = Math.min(alive * per, src.length);
        for (let i = 0; i < n; i++) {
          const v = Number(src[i]);
          dst[i] = Number.isFinite(v) ? v : 0;
        }
      }
    };
    set(this.pos, data.pos, 3);
    set(this.vel, data.vel, 3);
    set(this.life, data.life, 1);
    set(this.maxLife, data.maxLife, 1);
    set(this.size, data.psize, 1);
    set(this.rot, data.rot, 1);
    set(this.col0, data.col0, 3);
    set(this.col1, data.col1, 3);
    this.aliveCount = alive;
    this.attrsDirty = true;
  }
}

// Track C.1 reflection spike: explicit type string (minification-safe).
registerInspectorSchema('ParticleSystem', [
  { key: 'rate', label: 'Emission Rate /s', kind: 'slider', min: 0, max: 500, step: 1, group: 'Emission' },
  { key: 'maxParticles', label: 'Max Particles', kind: 'number', min: 1, max: 10000, step: 1, group: 'Emission' },
  { key: 'burst', label: 'Burst', kind: 'number', min: 0, step: 1, group: 'Emission' },
  { key: 'loop', label: 'Loop', kind: 'boolean', group: 'Emission' },
  { key: 'shape', label: 'Shape', kind: 'enum', options: ['point', 'box', 'sphere'], group: 'Shape' },
  { key: 'spread', label: 'Spread', kind: 'slider', min: 0, max: 1, step: 0.01, group: 'Shape' },
  { key: 'speedMin', label: 'Speed Min', kind: 'number', min: 0, step: 0.1, group: 'Motion' },
  { key: 'speedMax', label: 'Speed Max', kind: 'number', min: 0, step: 0.1, group: 'Motion' },
  { key: 'gravity', label: 'Gravity', kind: 'number', step: 0.1, group: 'Motion' },
  { key: 'lifetimeMin', label: 'Lifetime Min', kind: 'number', min: 0.01, step: 0.1, group: 'Lifetime' },
  { key: 'lifetimeMax', label: 'Lifetime Max', kind: 'number', min: 0.01, step: 0.1, group: 'Lifetime' },
  { key: 'startColor', label: 'Start Color', kind: 'color', group: 'Color' },
  { key: 'endColor', label: 'End Color', kind: 'color', group: 'Color' },
  { key: 'opacity', label: 'Opacity', kind: 'slider', min: 0, max: 1, step: 0.01, group: 'Color' }
]);
