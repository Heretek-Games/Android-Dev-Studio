import { Component } from '../core/Component.js';
import { CameraComponent } from '../components/CameraComponent.js';
import { smoothDamp, catmullRomPoint, traumaNoise, angleDelta, smoothstep } from './CineShots.js';
import type { TimelineClip } from './TimelineLite.js';

export interface DollySpec {
  path: Array<[number, number, number]>;
  ease?: 'smooth' | 'linear';
}

export interface ShakeSpec {
  trauma: number;
  decay?: number;
  freq?: number;
  ampPos?: number;
  ampRot?: number;
}

export interface CineCameraOptions {
  /** Trauma decay per second. Default 1.2. */
  traumaDecay?: number;
  /** Resting FOV when no clip drives it. Default 60. */
  baseFov?: number;
  /** FOV kick degrees per trauma². Default 5. */
  fovKick?: number;
}

/**
 * CineCamera — cinematic shot evaluator (Track 2.2, ADR-1790378702418).
 *
 * Cinemachine-informed shots evaluated by TimelineLite camera clips: hard
 * cuts, eased blends from the previous pose, look-target tracking with
 * deadzone + lookahead + SmoothDamp, dolly/crane Catmull-Rom paths, and a
 * trauma shake overlay with FOV kick. All state is serializable; evaluation
 * is headless-deterministic (table-free noise). Without an active camera
 * clip the component is inert (legacy path in TimelineLite applies).
 */
export class CineCamera extends Component {
  public traumaDecay: number = 1.2;
  public baseFov: number = 60;
  public fovKick: number = 5;

  public trauma: number = 0;
  public activeShotId: string | null = null;
  public cutsTaken: number = 0;
  public lastCutShot: string | null = null;

  private cineTime: number = 0;
  private yaw: number | null = null;
  private pitch: number | null = null;
  private yawVel: number = 0;
  private pitchVel: number = 0;
  private lastTargetPos: [number, number, number] | null = null;
  private lastClipId: string | null = null;
  private blendFromPos: [number, number, number] | null = null;
  private blendFromYaw: number = 0;
  private blendFromPitch: number = 0;
  private blendFromFov: number = 60;
  private blendT: number = 0;
  private blendDur: number = 0.5;

  constructor(options?: CineCameraOptions) {
    super();
    if (options) {
      if (options.traumaDecay !== undefined) this.traumaDecay = Math.max(0.01, options.traumaDecay);
      if (options.baseFov !== undefined) this.baseFov = options.baseFov;
      if (options.fovKick !== undefined) this.fovKick = options.fovKick;
    }
  }

  public addTrauma(amount: number): void {
    this.trauma = Math.min(1, Math.max(0, this.trauma + amount));
  }

  /**
   * Trauma always decays on component update (independent of clips), so a
   * shake settles even after its shot ends; offsets apply in evaluateShot.
   */
  public override update(deltaTime: number): void {
    this.trauma = Math.max(0, this.trauma - this.traumaDecay * deltaTime);
  }

  /**
   * Evaluates one camera-clip pass. `basePos` is the Timeline legacy lerp
   * (used when the shot carries no dolly path). Called by TimelineLite;
   * headless-safe (guards missing CameraComponent/threeCamera).
   */
  public evaluateShot(
    clip: TimelineClip,
    alpha: number,
    deltaTime: number,
    basePos: [number, number, number]
  ): void {
    const t = this.gameObject.transform;
    const data = (clip.data ?? {}) as Record<string, unknown>;
    this.cineTime += deltaTime;
    this.activeShotId = typeof data['shot'] === 'string' ? (data['shot'] as string) : clip.id;

    // Clip entry: capture blend origin, count cuts, inject shake trauma.
    if (this.lastClipId !== clip.id) {
      this.lastClipId = clip.id;
      this.blendFromPos = [t.position.x, t.position.y, t.position.z];
      this.blendFromYaw = t.rotation.y;
      this.blendFromPitch = t.rotation.x;
      this.blendFromFov = this.currentFov();
      const blend = typeof data['blend'] === 'number' ? (data['blend'] as number) : 0.5;
      this.blendDur = Math.max(0, blend);
      this.blendT = data['cut'] === true ? this.blendDur : 0;
      if (data['cut'] === true) {
        this.cutsTaken++;
        this.lastCutShot = this.activeShotId;
      }
      const shake = data['shake'] as ShakeSpec | undefined;
      if (shake && typeof shake.trauma === 'number') {
        if (typeof shake.decay === 'number') this.traumaDecay = Math.max(0.01, shake.decay);
        this.addTrauma(shake.trauma);
      }
    }
    this.blendT += deltaTime;
    const blendAlpha = this.blendDur <= 0 ? 1 : smoothstep(this.blendT / this.blendDur);

    // Shot position: dolly/crane path or legacy base.
    let shotPos = basePos;
    const dolly = (data['dolly'] ?? data['crane']) as DollySpec | undefined;
    if (dolly && Array.isArray(dolly.path) && dolly.path.length > 0) {
      const eased = dolly.ease === 'linear' ? alpha : smoothstep(alpha);
      shotPos = catmullRomPoint(dolly.path, eased);
    }
    const px = (this.blendFromPos?.[0] ?? shotPos[0]) + (shotPos[0] - (this.blendFromPos?.[0] ?? shotPos[0])) * blendAlpha;
    const py = (this.blendFromPos?.[1] ?? shotPos[1]) + (shotPos[1] - (this.blendFromPos?.[1] ?? shotPos[1])) * blendAlpha;
    const pz = (this.blendFromPos?.[2] ?? shotPos[2]) + (shotPos[2] - (this.blendFromPos?.[2] ?? shotPos[2])) * blendAlpha;

    // Look-target tracking with deadzone + lookahead + damping.
    let yaw = this.yaw ?? this.blendFromYaw;
    let pitch = this.pitch ?? this.blendFromPitch;
    const lookTarget = typeof data['lookTarget'] === 'string' ? (data['lookTarget'] as string) : null;
    if (lookTarget && this.gameObject.scene) {
      const target = this.gameObject.scene.findByName(lookTarget);
      if (target) {
        const tp = target.transform.position;
        const lookahead = typeof data['lookahead'] === 'number' ? (data['lookahead'] as number) : 0;
        let tx = tp.x;
        let ty = tp.y;
        let tz = tp.z;
        if (lookahead > 0 && this.lastTargetPos && deltaTime > 0) {
          const vx = (tp.x - this.lastTargetPos[0]) / deltaTime;
          const vy = (tp.y - this.lastTargetPos[1]) / deltaTime;
          const vz = (tp.z - this.lastTargetPos[2]) / deltaTime;
          tx += vx * lookahead;
          ty += vy * lookahead;
          tz += vz * lookahead;
        }
        this.lastTargetPos = [tp.x, tp.y, tp.z];
        const dx = tx - px;
        const dy = ty - py;
        const dz = tz - pz;
        const wantYaw = Math.atan2(dx, -dz);
        const wantPitch = -Math.atan2(dy, Math.hypot(dx, dz));
        const deadzone = typeof data['deadzone'] === 'number' ? (data['deadzone'] as number) : 0.02;
        const smoothTime = typeof data['smoothTime'] === 'number' ? (data['smoothTime'] as number) : 0.25;
        if (Math.abs(angleDelta(yaw, wantYaw)) >= deadzone) {
          [yaw, this.yawVel] = smoothDamp(yaw, yaw + angleDelta(yaw, wantYaw), this.yawVel, smoothTime, deltaTime);
        }
        [pitch, this.pitchVel] = smoothDamp(pitch, wantPitch, this.pitchVel, smoothTime, deltaTime);
      }
    }
    this.yaw = yaw;
    this.pitch = pitch;

    // Trauma overlay (quadratic energy, Godot recipe; decayed in update()).
    const shakeAmp = this.trauma * this.trauma;
    const shk = data['shake'] as ShakeSpec | undefined;
    const freq = typeof shk?.freq === 'number' ? shk.freq : 1;
    const ampPos = typeof shk?.ampPos === 'number' ? shk.ampPos : 0.3;
    const ampRot = typeof shk?.ampRot === 'number' ? shk.ampRot : 0.05;
    const ox = traumaNoise(this.cineTime * freq, 1) * ampPos * shakeAmp;
    const oy = traumaNoise(this.cineTime * freq, 7) * ampPos * shakeAmp;
    const roll = traumaNoise(this.cineTime * freq, 13) * ampRot * shakeAmp;

    t.position.set(px + ox, py + oy, pz);
    t.rotation.set(pitch, yaw, roll);

    // FOV: clip lerp + trauma kick.
    const fovData = data['fov'] as { from?: number; to?: number } | undefined;
    let fov = this.baseFov;
    if (fovData && typeof fovData.to === 'number') {
      const from = typeof fovData.from === 'number' ? fovData.from : this.blendFromFov;
      fov = from + (fovData.to - from) * alpha;
    }
    const kick = typeof data['fovKick'] === 'number' ? (data['fovKick'] as number) : this.fovKick;
    fov += shakeAmp * kick;
    const cam = this.gameObject.getComponent(CameraComponent);
    if (cam) {
      cam.fov = fov;
      if (cam.threeCamera) {
        cam.threeCamera.fov = fov;
        cam.threeCamera.updateProjectionMatrix();
      }
    }
  }

  private currentFov(): number {
    return this.gameObject.getComponent(CameraComponent)?.fov ?? this.baseFov;
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'CineCamera',
      enabled: this.enabled,
      traumaDecay: this.traumaDecay,
      baseFov: this.baseFov,
      fovKick: this.fovKick,
      trauma: this.trauma,
      activeShotId: this.activeShotId,
      cutsTaken: this.cutsTaken,
      lastCutShot: this.lastCutShot,
      cineTime: this.cineTime,
      yaw: this.yaw,
      pitch: this.pitch,
      yawVel: this.yawVel,
      pitchVel: this.pitchVel
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (typeof data.traumaDecay === 'number') this.traumaDecay = data.traumaDecay;
    if (typeof data.baseFov === 'number') this.baseFov = data.baseFov;
    if (typeof data.fovKick === 'number') this.fovKick = data.fovKick;
    if (typeof data.trauma === 'number') this.trauma = data.trauma;
    if (data.activeShotId !== undefined) this.activeShotId = data.activeShotId;
    if (typeof data.cutsTaken === 'number') this.cutsTaken = data.cutsTaken;
    if (data.lastCutShot !== undefined) this.lastCutShot = data.lastCutShot;
    if (typeof data.cineTime === 'number') this.cineTime = data.cineTime;
    if (data.yaw !== undefined) this.yaw = data.yaw;
    if (data.pitch !== undefined) this.pitch = data.pitch;
    if (typeof data.yawVel === 'number') this.yawVel = data.yawVel;
    if (typeof data.pitchVel === 'number') this.pitchVel = data.pitchVel;
  }
}
