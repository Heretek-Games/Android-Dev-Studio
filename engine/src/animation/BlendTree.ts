import { Component } from '../core/Component.js';

export interface AnimationClipEntry {
  name: string;
  duration: number;
  threshold: number; // e.g., 0.0 for Idle, 3.0 for Walk, 7.0 for Sprint
  speedMultiplier?: number;
}

export interface BlendStateResult {
  primaryClip: string;
  secondaryClip?: string;
  blendWeight: number; // 0.0 (100% primary) to 1.0 (100% secondary)
  normalizedTime: number;
}

/**
 * 1D Animation Blend Space:
 * Evaluates smooth cross-fades between locomotion animations based on a continuous
 * parameter (e.g. forward speed, movement magnitude), essential for Genshin Impact
 * and COD Mobile character state transitions.
 */
export class BlendTree1D {
  public parameter: string = 'speed';
  public entries: AnimationClipEntry[] = [];
  private currentTime: number = 0;

  constructor(parameter: string = 'speed', entries: AnimationClipEntry[] = []) {
    this.parameter = parameter;
    this.entries = entries.sort((a, b) => a.threshold - b.threshold);
  }

  public addEntry(entry: AnimationClipEntry): void {
    this.entries.push(entry);
    this.entries.sort((a, b) => a.threshold - b.threshold);
  }

  public evaluate(paramValue: number, deltaTime: number): BlendStateResult {
    if (this.entries.length === 0) {
      return { primaryClip: 'default', blendWeight: 0, normalizedTime: 0 };
    }

    if (this.entries.length === 1 || paramValue <= this.entries[0].threshold) {
      const e = this.entries[0];
      this.currentTime = (this.currentTime + deltaTime * (e.speedMultiplier || 1.0)) % e.duration;
      return {
        primaryClip: e.name,
        blendWeight: 0.0,
        normalizedTime: this.currentTime / e.duration
      };
    }

    const lastEntry = this.entries[this.entries.length - 1];
    if (paramValue >= lastEntry.threshold) {
      this.currentTime = (this.currentTime + deltaTime * (lastEntry.speedMultiplier || 1.0)) % lastEntry.duration;
      return {
        primaryClip: lastEntry.name,
        blendWeight: 0.0,
        normalizedTime: this.currentTime / lastEntry.duration
      };
    }

    // Find the two adjacent threshold intervals to interpolate
    for (let i = 0; i < this.entries.length - 1; i++) {
      const a = this.entries[i];
      const b = this.entries[i + 1];

      if (paramValue >= a.threshold && paramValue <= b.threshold) {
        const range = b.threshold - a.threshold;
        const weight = range > 0 ? (paramValue - a.threshold) / range : 0;
        const speed = (a.speedMultiplier || 1.0) * (1 - weight) + (b.speedMultiplier || 1.0) * weight;
        const duration = a.duration * (1 - weight) + b.duration * weight;

        this.currentTime = (this.currentTime + deltaTime * speed) % duration;

        return {
          primaryClip: a.name,
          secondaryClip: b.name,
          blendWeight: weight,
          normalizedTime: this.currentTime / duration
        };
      }
    }

    return { primaryClip: this.entries[0].name, blendWeight: 0, normalizedTime: 0 };
  }
}

export class AnimationController extends Component {
  public blendTrees: Map<string, BlendTree1D> = new Map();
  public parameters: Map<string, number> = new Map();
  public activeState: string = 'locomotion';
  public lastResult: BlendStateResult | null = null;

  constructor() {
    super();
    // Starter Locomotion Blend Tree (Idle -> Walk -> Sprint)
    const locomotion = new BlendTree1D('speed', [
      { name: 'Idle', duration: 2.0, threshold: 0.0 },
      { name: 'Walk', duration: 1.0, threshold: 3.0, speedMultiplier: 1.0 },
      { name: 'Sprint', duration: 0.7, threshold: 7.0, speedMultiplier: 1.2 }
    ]);
    this.blendTrees.set('locomotion', locomotion);
    this.parameters.set('speed', 0.0);
  }

  public setFloat(paramName: string, value: number): void {
    this.parameters.set(paramName, value);
  }

  public getFloat(paramName: string): number {
    return this.parameters.get(paramName) || 0.0;
  }

  public override update(deltaTime: number): void {
    const bt = this.blendTrees.get(this.activeState);
    if (bt) {
      const paramVal = this.getFloat(bt.parameter);
      this.lastResult = bt.evaluate(paramVal, deltaTime);
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'AnimationController',
      activeState: this.activeState,
      parameters: Object.fromEntries(this.parameters.entries())
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.activeState) this.activeState = data.activeState;
    if (data.parameters) {
      for (const [k, v] of Object.entries(data.parameters)) {
        this.parameters.set(k, v as number);
      }
    }
  }
}
