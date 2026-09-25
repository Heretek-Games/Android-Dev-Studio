import { Component } from '../core/Component.js';

export interface TimerOptions {
  /** Countdown length in seconds. Default 1. */
  duration?: number;
  /** Restart automatically on expiry. Default false. */
  repeat?: boolean;
  /** Start counting on attach. Default true. */
  autostart?: boolean;
}

/** Boundary tolerance for IEEE754 accumulation (see update). */
const EPSILON = 1e-9;

/**
 * Timer behavior (Track 1.3 behavior library, GDevelop-informed).
 *
 * Headless-deterministic countdown: `expiredCount` increments on every
 * expiry (once, or per repeat cycle); `elapsed` tracks progress for bars
 * and sequencing. EventSheets poll `expiredCount`; no callbacks cross the
 * serialization boundary, so undo restore stays exact.
 */
export class Timer extends Component {
  public duration: number = 1.0;
  public repeat: boolean = false;
  public expiredCount: number = 0;
  public elapsed: number = 0;
  public running: boolean = true;

  constructor(options?: TimerOptions) {
    super();
    if (options) {
      if (options.duration !== undefined) this.duration = Math.max(0.0001, options.duration);
      if (options.repeat !== undefined) this.repeat = options.repeat;
      if (options.autostart !== undefined) this.running = options.autostart;
    }
  }

  /**
   * Resumes counting. Named play()/pause() (not start()/stop()) because
   * Component.start() is the engine attach-lifecycle hook — overriding it
   * would let Scene.addGameObject force autostart:false timers back on.
   */
  public play(): void {
    this.running = true;
  }

  public pause(): void {
    this.running = false;
  }

  public reset(): void {
    this.elapsed = 0;
    this.expiredCount = 0;
    this.running = true;
  }

  public get progress(): number {
    return Math.min(1, Math.max(0, this.elapsed / this.duration));
  }

  public override update(deltaTime: number): void {
    if (!this.running) return;
    this.elapsed += deltaTime;
    // EPSILON keeps exact-multiple boundaries deterministic: 30 x (1/60)
    // sums to 0.49999999999999994 in IEEE754, which must still trip a 0.5
    // duration rather than slipping a frame depending on accumulation order.
    if (this.elapsed + EPSILON >= this.duration) {
      this.expiredCount++;
      if (this.repeat) {
        // Subtract (never modulo): when EPSILON trips a boundary from just
        // below, modulo would return elapsed unchanged and double-fire next
        // frame; subtraction keeps the cadence exact.
        this.elapsed -= this.duration;
      } else {
        this.elapsed = this.duration;
        this.running = false;
      }
    }
  }

  public override toJSON(): Record<string, any> {
    return {
      type: 'Timer',
      enabled: this.enabled,
      duration: this.duration,
      repeat: this.repeat,
      expiredCount: this.expiredCount,
      elapsed: this.elapsed,
      running: this.running
    };
  }

  public override fromJSON(data: Record<string, any>): void {
    if (data.enabled !== undefined) this.enabled = data.enabled;
    if (data.duration !== undefined) this.duration = data.duration;
    if (data.repeat !== undefined) this.repeat = data.repeat;
    if (data.expiredCount !== undefined) this.expiredCount = data.expiredCount;
    if (data.elapsed !== undefined) this.elapsed = data.elapsed;
    if (data.running !== undefined) this.running = data.running;
  }
}
