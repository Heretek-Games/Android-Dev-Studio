import { Component } from '../core/Component.js';
import { MeshRenderer } from '../components/MeshRenderer.js';

/**
 * Tween behavior (Track 1.3 behavior library, GDevelop-informed).
 *
 * Animates transform position/size/rotation and MeshRenderer color over time
 * with named, restartable tweens and standard easings (easings.net set).
 * Headless-deterministic: driven purely by update(dt), no wall-clock use.
 */

export type TweenEase =
  | 'linear'
  | 'easeInQuad' | 'easeOutQuad' | 'easeInOutQuad'
  | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic'
  | 'easeOutBack' | 'easeOutElastic';

export interface TweenSpec {
  /** Property path: 'position.x' | 'position.y' | 'position.z' | 'scale' | 'scale.x' | 'rotation.y' | 'color'. */
  property: string;
  to: number | number[] | string;
  duration?: number;
  delay?: number;
  ease?: TweenEase;
  loop?: boolean;
}

interface ActiveTween extends Required<Omit<TweenSpec, 'to' | 'property'>> {
  property: string;
  to: number | number[] | string;
  elapsed: number;
  from: number | number[] | string;
  done: boolean;
}

function easeValue(ease: TweenEase, t: number): number {
  switch (ease) {
    case 'linear': return t;
    case 'easeInQuad': return t * t;
    case 'easeOutQuad': return 1 - (1 - t) * (1 - t);
    case 'easeInOutQuad': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'easeInCubic': return t * t * t;
    case 'easeOutCubic': return 1 - Math.pow(1 - t, 3);
    case 'easeInOutCubic': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'easeOutBack': {
      const c = 1.70158;
      return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
    }
    case 'easeOutElastic': {
      if (t === 0 || t === 1) return t;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    }
    default: return t;
  }
}

function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class Tween extends Component {
  private tweens = new Map<string, ActiveTween>();

  public play(name: string, spec: TweenSpec): void {
    const duration = Math.max(0.0001, spec.duration ?? 1.0);
    this.tweens.set(name, {
      property: spec.property,
      to: spec.to,
      duration,
      delay: spec.delay ?? 0,
      ease: spec.ease ?? 'linear',
      loop: spec.loop ?? false,
      elapsed: 0,
      from: this.readProperty(spec.property),
      done: false
    });
  }

  public stop(name: string): void {
    this.tweens.delete(name);
  }

  public isPlaying(name: string): boolean {
    const tween = this.tweens.get(name);
    return !!tween && !tween.done;
  }

  public override update(deltaTime: number): void {
    for (const tween of this.tweens.values()) {
      if (tween.done) continue;
      tween.elapsed += deltaTime;
      const local = tween.elapsed - tween.delay;
      if (local < 0) continue;
      const raw = Math.min(1, local / tween.duration);
      const shaped = easeValue(tween.ease, raw);
      this.writeProperty(tween.property, tween.from, tween.to, shaped);
      if (raw >= 1) {
        if (tween.loop) {
          tween.elapsed = 0;
          tween.from = this.readProperty(tween.property);
        } else {
          tween.done = true;
        }
      }
    }
  }

  private readProperty(property: string): number | number[] | string {
    const t = this.gameObject.transform;
    switch (property) {
      case 'position.x': return t.position.x;
      case 'position.y': return t.position.y;
      case 'position.z': return t.position.z;
      case 'scale.x': return t.scale.x;
      case 'scale.y': return t.scale.y;
      case 'scale.z': return t.scale.z;
      case 'scale': return [t.scale.x, t.scale.y, t.scale.z];
      case 'rotation.y': return t.rotation.y;
      case 'color': {
        return this.gameObject.getComponent(MeshRenderer)?.color ?? '#ffffff';
      }
      default: return 0;
    }
  }

  private writeProperty(
    property: string,
    from: number | number[] | string,
    to: number | number[] | string,
    t: number
  ): void {
    const tr = this.gameObject.transform;
    const num = (a: unknown, b: unknown): number =>
      lerpNumber(typeof a === 'number' ? a : 0, typeof b === 'number' ? b : 0, t);
    switch (property) {
      case 'position.x': tr.position.x = num(from, to); break;
      case 'position.y': tr.position.y = num(from, to); break;
      case 'position.z': tr.position.z = num(from, to); break;
      case 'scale.x': tr.scale.x = num(from, to); break;
      case 'scale.y': tr.scale.y = num(from, to); break;
      case 'scale.z': tr.scale.z = num(from, to); break;
      case 'scale': {
        const f = Array.isArray(from) ? from : [1, 1, 1];
        const tt = Array.isArray(to) ? to : [1, 1, 1];
        tr.scale.set(num(f[0], tt[0]), num(f[1], tt[1]), num(f[2], tt[2]));
        break;
      }
      case 'rotation.y': tr.rotation.y = num(from, to); break;
      case 'color': {
        const mesh = this.gameObject.getComponent(MeshRenderer);
        if (mesh && typeof to === 'string') mesh.setMaterial(to);
        break;
      }
      default: break;
    }
  }

  public override toJSON(): Record<string, any> {
    return { type: 'Tween', enabled: this.enabled };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
  }
}
