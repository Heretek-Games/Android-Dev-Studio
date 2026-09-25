import { Component } from '../core/Component.js';

export interface TimerOptions {
  /** Countdown length in seconds. Default 1. */
  duration?: number;
  /** Restart automatically on expiry. Default false. */
  repeat?: boolean;
  /** Start counting on attach. Default true. */
  autostart?: boolean;
}

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

  public start(): void {
    this.running = true;
  }

  public stop(): void {
    this.running = false;
  }

  public reset(): void {
    this.elapsed = 0;
    this.expiredCount = 0;
    this.running = true;
  }

  public get progress(): number {
    return Math.min(1, this.elapsed / this.duration);
  }

  public override update(deltaTime: number): void {
    if (!this.running) return;
    this.elapsed += deltaTime;
    if (this.elapsed >= this.duration) {
      this.expiredCount++;
      if (this.repeat) {
        this.elapsed = this.elapsed % this.duration;
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
